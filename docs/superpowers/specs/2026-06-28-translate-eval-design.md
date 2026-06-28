# Translate accuracy benchmark — design

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/trust-layer`

## Problem

HealthFlow's landing promise is "coverage advice you can defend." Today the
only signal that an agent's output is *correct* is a broker's thumbs-up,
collected by the RLHF feedback loop (`healthflow/feedback/`). A thumbs-up
measures whether an answer was *liked*, not whether it was *right*. In a
regulated setting, "we can prove our agents are accurate" is the differentiator.

This is the first slice of a broader "trust layer." It builds an **accuracy
benchmark** — a reproducible score for how correct an agent is against a gold
dataset of known-right answers — starting with the **coverage translator**, the
agent where a wrong answer (telling a client the wrong copay) is the scary
failure and where "correct vs. merely plausible" is hardest to tell apart.

## Goal

Produce a reproducible accuracy score for the translation agent against real
Medicare plan documents, broken into faithfulness, abstention, and
hallucination metrics. Run on demand (it costs tokens and is non-deterministic),
with the harness's own scoring/aggregation logic unit-tested in normal CI.

## Non-goals (explicit out-of-scope for v1)

- **Fixing the agent's citations.** `TranslationAgent.translate` returns
  `[s.title for s in prompt_input.sections]` — i.e. the titles of *every*
  section it was handed, not the section(s) that actually grounded the answer.
  "Did it cite the right section?" is therefore not gradable against the current
  agent. Citation correctness is deferred; emitting true citations is a noted
  follow-up that the eval motivates.
- **Benchmarking the other agents** (compare, cost, network, appeal). The
  deterministic agents (compare/cost/network) and appeal need different scorers;
  they reuse this harness later.
- **Regression-gating prompt-variant rollouts.** The accuracy benchmark is the
  foundation; wiring it into the `PromptVariant` A/B system as a promotion gate
  is a later phase.
- **A live PDF-fetching pipeline.** Source documents are vendored as committed
  text fixtures (see Gold dataset).

## The agent under test

`healthflow/agents/translation_agent.py`:

```python
def translate(self, sections: list[DocumentSection], question: str)
    -> tuple[str, list[str]]:   # (answer, section_titles)
```

- **Input:** `sections` (each a `DocumentSection` with `title` + `content`) and
  a `question`.
- **Output:** `(answer, section_titles)`. The answer is free-form plain English;
  `section_titles` echoes the input titles (see non-goals).
- **Model:** Sonnet (`CLAUDE_MODEL_SONNET`). The system prompt instructs it to
  answer only the question, translate jargon, and say so when the document
  doesn't contain the answer — that last instruction is what the **abstention**
  metric measures.

## Architecture

A new top-level package `healthflow/evals/`, mirroring `healthflow/forensics/`:

```
healthflow/evals/
  __init__.py
  translate/
    __init__.py
    fixtures/
      <plan-slug>.md          # vendored real SoB excerpt (markdown sections)
      provenance.md           # plan name, year, source URL per fixture
    cases.yaml                # the gold dataset
    loader.py                 # parse fixtures + cases.yaml into typed objects
    runner.py                 # invoke the real TranslationAgent per case
    judge.py                  # LLM-as-judge (own prompt + structured output)
    scorer.py                 # hybrid score: deterministic checks + judge
    report.py                 # aggregate per-case results, write report
    run.py                    # entrypoint wired to `make eval`
  tests/
    test_loader.py
    test_scorer.py            # deterministic checks + judge-verdict blending
    test_report.py            # aggregation math
    test_judge.py             # judge prompt build + response parse (mocked client)
```

Each unit has one purpose and a typed interface, so the deterministic pieces are
testable without any live API call.

## Components

### Gold dataset

**Fixtures** — `fixtures/<plan-slug>.md`: relevant sections of a real public
Medicare Advantage Summary of Benefits, extracted to markdown. SoB documents are
public marketing material (no PHI). `provenance.md` records plan name, year, and
source URL for each fixture so the dataset is auditable. v1: **1–2 real plans.**

A fixture is parsed into `list[DocumentSection]` by splitting on `##` headings
(title = heading text, content = body until the next heading).

**`cases.yaml`** — the gold Q&A. Each case:

```yaml
- id: er-copay-admitted            # unique, stable
  doc: humana-gold-plus-2026       # -> fixtures/humana-gold-plus-2026.md
  question: "What's my ER copay if I'm admitted?"
  answerable: true                 # is the answer present in the doc?
  expect_facts:                    # checkable facts (optional; answerable cases)
    amounts: [120]                 # dollar figures that must appear
  gold_answer: >                   # the reference answer (judge compares to this)
    The ER copay is $120, but it is waived if you are admitted.

- id: dental-implants
  doc: humana-gold-plus-2026
  question: "Are dental implants covered?"
  answerable: false                # agent MUST abstain, not invent an answer
```

v1: **~15–20 cases**, deliberately including `answerable: false` (abstention)
and traps like waived-if-admitted.

### Loader (`loader.py`)

Pure, no I/O beyond reading the fixture/yaml files. Parses `cases.yaml` and the
referenced fixtures into typed objects:

```python
@dataclass(frozen=True)
class EvalCase:
    id: str
    sections: list[DocumentSection]   # resolved from the fixture
    question: str
    answerable: bool
    expect_amounts: list[int]         # [] when none
    gold_answer: str | None           # None for unanswerable cases

def load_cases(path: Path) -> list[EvalCase]: ...
```

Validates: every `doc` resolves to a fixture; unanswerable cases have no
`expect_facts`/`gold_answer`; ids are unique. Raises on malformed data.

### Runner (`runner.py`)

Invokes the real `TranslationAgent.translate(case.sections, case.question)` per
case, returning the raw `(answer, section_titles)` plus the case. This is the
only component that hits the agent's live API. Kept thin so the scorer can be
tested against canned agent outputs.

```python
@dataclass(frozen=True)
class AgentRun:
    case: EvalCase
    answer: str

def run_case(agent, case: EvalCase) -> AgentRun: ...
```

### Judge (`judge.py`)

LLM-as-judge. Given the source sections, the question, the gold answer, and the
agent answer, returns a structured verdict. Uses a forced-tool / JSON structured
output (validated, with a retry on malformed output, following the existing
`harness.strip_code_fence` + schema pattern).

```python
@dataclass(frozen=True)
class JudgeVerdict:
    faithful: bool          # answer is supported by the source sections
    hallucinated: bool      # asserts a benefit not in the source
    contradicts_gold: bool  # disagrees with the gold answer
    rationale: str          # one-line why (for the report)

def judge(client, sections, question, gold_answer, agent_answer) -> JudgeVerdict: ...
```

The judge prompt is deliberately narrow ("is this answer supported by THESE
sections") to keep it grounded rather than asking it to know Medicare facts on
its own. Judge model: Sonnet (judging is nuanced extraction, not deep reasoning).

### Scorer (`scorer.py`)

Pure function blending deterministic checks with the judge verdict into a
per-case score. No I/O, no API — takes an `AgentRun` and (for answerable cases)
a `JudgeVerdict`.

```python
@dataclass(frozen=True)
class CaseScore:
    case_id: str
    answerable: bool
    abstained: bool            # detected "not in document"-style answer
    amounts_present: bool      # all expect_amounts appear in the answer
    faithful: bool | None      # from judge (None for unanswerable/abstained)
    hallucinated: bool | None
    contradicts_gold: bool | None
    passed: bool               # overall verdict for this case

def score(run: AgentRun, verdict: JudgeVerdict | None) -> CaseScore: ...
```

Rules:
- **Unanswerable case:** `passed` iff the agent abstained. `run.py` skips the
  judge entirely for unanswerable cases, passing `verdict=None` to the scorer.
- **Answerable case:** `passed` iff `amounts_present` AND `faithful` AND NOT
  `hallucinated` AND NOT `contradicts_gold`. `amounts_present` is vacuously
  `True` when `expect_amounts` is empty (not every answerable case has a dollar
  figure to check).
- Abstention is detected by a small, documented set of markers (e.g. "not in the
  document", "doesn't contain", "unable to determine") — a deterministic helper
  with its own unit tests so the heuristic is explicit and tunable.

### Report (`report.py`)

Aggregates `list[CaseScore]` into metrics and renders both a machine-readable
JSON and a human summary:

- `faithfulness_rate` (answerable cases judged faithful)
- `abstention_accuracy` (unanswerable cases the agent correctly abstained on)
- `hallucination_rate` (answerable cases with a hallucination)
- `pass_rate` (overall)
- per-case table (id, passed, failure reason)

Pure aggregation given the scores; unit-tested with hand-built `CaseScore` lists.

### Entrypoint (`run.py`) + `make eval`

`run.py` orchestrates: load cases → for each, run the agent → (answerable) call
the judge → score → aggregate → write report to `evals/translate/report.json`
and print the summary. Guarded so it only runs when `LIVE_EVAL=1` (mirrors
`make smoke-external`'s `LIVE_SMOKE_TESTS=1` gate), and fails fast with a clear
message if `ANTHROPIC_API_KEY` is unset.

`Makefile`:
```
eval: ## Run the translate accuracy benchmark (live; needs ANTHROPIC_API_KEY)
	LIVE_EVAL=1 .venv/bin/python -m healthflow.evals.translate.run
```

## Data flow

```
cases.yaml + fixtures/         (committed gold data)
        |  loader.load_cases
        v
   list[EvalCase]
        |  runner.run_case (LIVE: TranslationAgent)
        v
     AgentRun  --answerable?--> judge.judge (LIVE) --> JudgeVerdict
        |                                                  |
        +------------------ scorer.score <----------------+
                                |
                          list[CaseScore]
                                |  report.aggregate
                                v
                    report.json + printed summary
```

## Testing strategy

- **Unit (normal CI, no API):** `loader` (parsing + validation), `scorer`
  (every passed/failed branch, abstention detection), `report` (aggregation
  math), `judge` (prompt construction + response parsing with a **mocked**
  Anthropic client returning canned JSON). These follow TDD.
- **Live (`make eval`, opt-in):** the full benchmark against the real agent +
  real judge. Not in default CI — costs tokens, non-deterministic.

This mirrors the repo's existing split: deterministic logic is unit-tested;
network/LLM-touching paths are opt-in (`make smoke-external`).

## Open dependency

Obtaining the real SoB fixtures. Source 1–2 public Medicare Advantage Summary of
Benefits documents (CMS / carrier sites), extract the relevant sections to the
`fixtures/*.md` files, and record provenance. The authored `gold_answer`s and
`expect_facts` are verified by hand against the real document language. If a
specific carrier/plan is preferred, the user supplies it; otherwise pick a
well-known public plan.

## Follow-ups (post-v1)

1. Upgrade `TranslationAgent` to emit true citations (which section grounded the
   answer); add a citation-correctness metric.
2. Benchmarks for compare/cost/network (deterministic scorers) and appeal.
3. Wire the benchmark into the `PromptVariant` rollout as a promotion gate
   (the regression-gate use of the same gold data).
