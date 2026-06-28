# Translate Accuracy Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible accuracy benchmark for the coverage-translator agent that scores answers against real Medicare Summary-of-Benefits documents using a hybrid (deterministic + LLM-as-judge) scorer.

**Architecture:** A self-contained `healthflow/evals/translate/` package. Pure-logic units (loader, scorer, report, judge-parsing) are unit-tested in normal CI with no API calls. The live entrypoint (`make eval`, gated by `LIVE_EVAL=1`) runs the real agent + real judge over a committed gold dataset and writes a report. Spec: `docs/superpowers/specs/2026-06-28-translate-eval-design.md`.

**Tech Stack:** Python 3.14, pytest, PyYAML, the Anthropic SDK (already a dependency), Pydantic `DocumentSection` (reused from `healthflow/models/schemas.py`).

---

### Task 1: Scaffold the evals package

**Files:**
- Create: `healthflow/evals/__init__.py`
- Create: `healthflow/evals/translate/__init__.py`
- Create: `healthflow/evals/tests/__init__.py`
- Create: `healthflow/evals/tests/conftest.py`

- [ ] **Step 1: Create the package `__init__.py` files (empty)**

Create three empty files:
- `healthflow/evals/__init__.py`
- `healthflow/evals/translate/__init__.py`
- `healthflow/evals/tests/__init__.py`

- [ ] **Step 2: Create the test conftest**

Some `healthflow.*` modules raise at import if these env vars are unset.
The eval unit tests don't touch that chain today, but set them defensively so
the package stays importable as it grows (mirrors `healthflow/tests/conftest.py`).

`healthflow/evals/tests/conftest.py`:
```python
import base64 as _base64
import os

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault(
    "PHI_ENCRYPTION_KEY",
    _base64.b64encode(b"\x00" * 32).decode(),
)
```

- [ ] **Step 3: Verify the package imports**

Run: `.venv/bin/python -c "import healthflow.evals.translate"`
Expected: no output, exit 0.

- [ ] **Step 4: Wire eval tests into `make test`**

Modify `Makefile` — the `test` target currently reads:
```
test: ## Run all backend tests
	.venv/bin/python -m pytest healthflow/tests/ healthflow/agents/temporal_awareness/tests/ healthflow/forensics/tests/ -v --tb=short
```
Add `healthflow/evals/tests/` to the path list:
```
test: ## Run all backend tests
	.venv/bin/python -m pytest healthflow/tests/ healthflow/agents/temporal_awareness/tests/ healthflow/forensics/tests/ healthflow/evals/tests/ -v --tb=short
```

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals Makefile
git commit -m "feat(evals): scaffold the evals package + wire tests into make test"
```

---

### Task 2: Loader — parse fixtures + cases.yaml into typed cases

**Files:**
- Create: `healthflow/evals/translate/loader.py`
- Test: `healthflow/evals/tests/test_loader.py`

- [ ] **Step 1: Write the failing tests**

`healthflow/evals/tests/test_loader.py`:
```python
from pathlib import Path

import pytest

from healthflow.evals.translate.loader import EvalCase, load_cases, parse_fixture


def _write(tmp_path: Path):
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    (fixtures / "plan-a.md").write_text(
        "## Emergency Care\nER copay is $120, waived if admitted.\n\n"
        "## Dental\nRoutine cleanings only.\n"
    )
    (tmp_path / "cases.yaml").write_text(
        "- id: er-copay\n"
        "  doc: plan-a\n"
        "  question: ER copay if admitted?\n"
        "  answerable: true\n"
        "  expect_facts:\n"
        "    amounts: [120]\n"
        "  gold_answer: The ER copay is $120, waived if admitted.\n"
        "- id: implants\n"
        "  doc: plan-a\n"
        "  question: Are dental implants covered?\n"
        "  answerable: false\n"
    )
    return tmp_path / "cases.yaml"


def test_parse_fixture_splits_on_headings(tmp_path):
    f = tmp_path / "p.md"
    f.write_text("## A\nalpha\n\n## B\nbeta\n")
    sections = parse_fixture(f)
    assert [s.title for s in sections] == ["A", "B"]
    assert sections[0].content.strip() == "alpha"


def test_load_cases_resolves_sections_and_fields(tmp_path):
    cases = load_cases(_write(tmp_path))
    assert [c.id for c in cases] == ["er-copay", "implants"]
    er = cases[0]
    assert isinstance(er, EvalCase)
    assert er.answerable is True
    assert er.expect_amounts == [120]
    assert er.gold_answer.startswith("The ER copay")
    assert [s.title for s in er.sections] == ["Emergency Care", "Dental"]
    implants = cases[1]
    assert implants.answerable is False
    assert implants.expect_amounts == []
    assert implants.gold_answer is None


def test_load_cases_rejects_unknown_doc(tmp_path):
    cases_path = _write(tmp_path)
    cases_path.write_text(
        "- id: x\n  doc: missing\n  question: q?\n  answerable: true\n"
    )
    with pytest.raises(ValueError, match="missing"):
        load_cases(cases_path)


def test_load_cases_rejects_duplicate_ids(tmp_path):
    cases_path = _write(tmp_path)
    cases_path.write_text(
        "- id: dup\n  doc: plan-a\n  question: q?\n  answerable: false\n"
        "- id: dup\n  doc: plan-a\n  question: q2?\n  answerable: false\n"
    )
    with pytest.raises(ValueError, match="duplicate"):
        load_cases(cases_path)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_loader.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'healthflow.evals.translate.loader'`.

- [ ] **Step 3: Write the loader**

`healthflow/evals/translate/loader.py`:
```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from healthflow.models.schemas import DocumentSection


@dataclass(frozen=True)
class EvalCase:
    id: str
    sections: list[DocumentSection]
    question: str
    answerable: bool
    expect_amounts: list[int]
    gold_answer: str | None


def parse_fixture(path: Path) -> list[DocumentSection]:
    """Split a fixture markdown file into sections on `## ` headings."""
    sections: list[DocumentSection] = []
    title: str | None = None
    body: list[str] = []
    for line in path.read_text().splitlines():
        if line.startswith("## "):
            if title is not None:
                sections.append(DocumentSection(title=title, content="\n".join(body).strip()))
            title = line[3:].strip()
            body = []
        else:
            body.append(line)
    if title is not None:
        sections.append(DocumentSection(title=title, content="\n".join(body).strip()))
    return sections


def load_cases(cases_path: Path) -> list[EvalCase]:
    """Load cases.yaml and resolve each referenced fixture into sections."""
    cases_path = Path(cases_path)
    fixtures_dir = cases_path.parent / "fixtures"
    raw = yaml.safe_load(cases_path.read_text()) or []

    seen: set[str] = set()
    cases: list[EvalCase] = []
    for entry in raw:
        cid = entry["id"]
        if cid in seen:
            raise ValueError(f"duplicate case id: {cid}")
        seen.add(cid)

        fixture = fixtures_dir / f"{entry['doc']}.md"
        if not fixture.exists():
            raise ValueError(f"case {cid}: fixture not found for doc '{entry['doc']}'")

        answerable = bool(entry["answerable"])
        facts = entry.get("expect_facts") or {}
        cases.append(
            EvalCase(
                id=cid,
                sections=parse_fixture(fixture),
                question=entry["question"],
                answerable=answerable,
                expect_amounts=list(facts.get("amounts", [])),
                gold_answer=entry.get("gold_answer") if answerable else None,
            )
        )
    return cases
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_loader.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals/translate/loader.py healthflow/evals/tests/test_loader.py
git commit -m "feat(evals): translate gold-data loader"
```

---

### Task 3: Judge — LLM-as-judge verdict with parsing + retry

**Files:**
- Create: `healthflow/evals/translate/judge.py`
- Test: `healthflow/evals/tests/test_judge.py`

- [ ] **Step 1: Write the failing tests**

The judge takes a `client` (the Anthropic client) so tests inject a fake that
returns canned content. Mirrors the real SDK shape: `client.messages.create(...)`
returns an object whose `.content[0].text` holds the string.

`healthflow/evals/tests/test_judge.py`:
```python
import pytest

from healthflow.evals.translate.judge import JudgeVerdict, judge
from healthflow.models.schemas import DocumentSection

SECTIONS = [DocumentSection(title="ER", content="ER copay $120, waived if admitted.")]


class _Block:
    def __init__(self, text): self.text = text


class _Resp:
    def __init__(self, text): self.content = [_Block(text)]


class FakeClient:
    """Returns queued responses; records calls."""
    def __init__(self, *texts):
        self._texts = list(texts)
        self.calls = 0
        class _M:
            def create(_self, **kwargs):
                self.calls += 1
                return _Resp(self._texts.pop(0))
        self.messages = _M()


def test_judge_parses_clean_json():
    client = FakeClient(
        '{"faithful": true, "hallucinated": false, "contradicts_gold": false, "rationale": "matches doc"}'
    )
    v = judge(client, SECTIONS, "ER copay?", "It is $120, waived if admitted.", "Your ER copay is $120, waived on admission.")
    assert isinstance(v, JudgeVerdict)
    assert v.faithful is True
    assert v.hallucinated is False
    assert v.contradicts_gold is False
    assert v.rationale == "matches doc"
    assert client.calls == 1


def test_judge_strips_code_fence():
    client = FakeClient(
        '```json\n{"faithful": false, "hallucinated": true, "contradicts_gold": true, "rationale": "invented dental"}\n```'
    )
    v = judge(client, SECTIONS, "Dental?", "Not covered.", "Dental implants are fully covered.")
    assert v.faithful is False
    assert v.hallucinated is True


def test_judge_retries_once_on_bad_json_then_succeeds():
    client = FakeClient(
        "not json at all",
        '{"faithful": true, "hallucinated": false, "contradicts_gold": false, "rationale": "ok"}',
    )
    v = judge(client, SECTIONS, "q?", "gold", "answer")
    assert v.faithful is True
    assert client.calls == 2


def test_judge_raises_after_two_bad_responses():
    client = FakeClient("garbage", "still garbage")
    with pytest.raises(ValueError, match="judge"):
        judge(client, SECTIONS, "q?", "gold", "answer")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_judge.py -v`
Expected: FAIL — module `judge` not found.

- [ ] **Step 3: Write the judge**

`healthflow/evals/translate/judge.py`:
```python
from __future__ import annotations

import json
from dataclasses import dataclass

from healthflow.agents.harness import CLAUDE_MODEL_SONNET, extract_text, strip_code_fence
from healthflow.models.schemas import DocumentSection

SYSTEM_PROMPT = (
    "You are a strict grader for an insurance-document Q&A assistant. "
    "You judge ONLY whether the assistant's answer is supported by the provided "
    "document sections — never by your own knowledge of insurance. "
    "Respond with a single JSON object and nothing else."
)


@dataclass(frozen=True)
class JudgeVerdict:
    faithful: bool
    hallucinated: bool
    contradicts_gold: bool
    rationale: str


def _build_prompt(sections, question, gold_answer, agent_answer) -> str:
    lines = ["DOCUMENT SECTIONS:", ""]
    for s in sections:
        lines += [f"## {s.title}", s.content, ""]
    lines += [
        "---",
        f"QUESTION: {question}",
        f"REFERENCE (known-correct) ANSWER: {gold_answer}",
        f"ASSISTANT ANSWER: {agent_answer}",
        "",
        "Judge the assistant answer. Return JSON with exactly these keys:",
        '{"faithful": bool, "hallucinated": bool, "contradicts_gold": bool, "rationale": "one short sentence"}',
        "- faithful: every claim in the assistant answer is supported by the document sections.",
        "- hallucinated: the assistant answer asserts a benefit/number NOT in the document sections.",
        "- contradicts_gold: the assistant answer disagrees with the reference answer.",
    ]
    return "\n".join(lines)


def _parse(text: str) -> JudgeVerdict:
    data = json.loads(strip_code_fence(text))
    return JudgeVerdict(
        faithful=bool(data["faithful"]),
        hallucinated=bool(data["hallucinated"]),
        contradicts_gold=bool(data["contradicts_gold"]),
        rationale=str(data.get("rationale", "")),
    )


def judge(client, sections: list[DocumentSection], question: str, gold_answer: str, agent_answer: str) -> JudgeVerdict:
    """Grade an agent answer with an LLM judge. Retries once on malformed JSON."""
    prompt = _build_prompt(sections, question, gold_answer, agent_answer)
    last_err: Exception | None = None
    for _ in range(2):
        resp = client.messages.create(
            model=CLAUDE_MODEL_SONNET,
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        try:
            return _parse(extract_text(resp))
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            last_err = e
    raise ValueError(f"judge returned unparseable output twice: {last_err}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_judge.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals/translate/judge.py healthflow/evals/tests/test_judge.py
git commit -m "feat(evals): LLM-as-judge for translate faithfulness/hallucination"
```

---

### Task 4: Runner — invoke the real agent per case

**Files:**
- Create: `healthflow/evals/translate/runner.py`
- Test: `healthflow/evals/tests/test_runner.py`

- [ ] **Step 1: Write the failing test**

The runner is thin: it calls `agent.translate(sections, question)` and keeps the
answer. The test uses a fake agent (duck-typed) so no API is hit.

`healthflow/evals/tests/test_runner.py`:
```python
from healthflow.evals.translate.loader import EvalCase
from healthflow.evals.translate.runner import AgentRun, run_case
from healthflow.models.schemas import DocumentSection


class FakeAgent:
    def __init__(self, answer): self.answer = answer; self.seen = None
    def translate(self, sections, question):
        self.seen = (sections, question)
        return self.answer, [s.title for s in sections]


def test_run_case_invokes_agent_and_keeps_answer():
    case = EvalCase(
        id="c1",
        sections=[DocumentSection(title="ER", content="copay $120")],
        question="ER copay?",
        answerable=True,
        expect_amounts=[120],
        gold_answer="$120",
    )
    agent = FakeAgent("Your ER copay is $120.")
    run = run_case(agent, case)
    assert isinstance(run, AgentRun)
    assert run.case is case
    assert run.answer == "Your ER copay is $120."
    assert agent.seen[1] == "ER copay?"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_runner.py -v`
Expected: FAIL — module `runner` not found.

- [ ] **Step 3: Write the runner**

`healthflow/evals/translate/runner.py`:
```python
from __future__ import annotations

from dataclasses import dataclass

from healthflow.evals.translate.loader import EvalCase


@dataclass(frozen=True)
class AgentRun:
    case: EvalCase
    answer: str


def run_case(agent, case: EvalCase) -> AgentRun:
    """Invoke the translation agent on one case and capture its answer.

    `agent` is any object with `.translate(sections, question) -> (answer, titles)`
    — the real `TranslationAgent` in production, a fake in tests. The echoed
    section titles are intentionally discarded (the agent doesn't emit true
    citations; see the spec's non-goals).
    """
    answer, _titles = agent.translate(case.sections, case.question)
    return AgentRun(case=case, answer=answer)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_runner.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals/translate/runner.py healthflow/evals/tests/test_runner.py
git commit -m "feat(evals): runner that invokes the translate agent per case"
```

---

### Task 5: Scorer — abstention detector + hybrid per-case score

**Files:**
- Create: `healthflow/evals/translate/scorer.py`
- Test: `healthflow/evals/tests/test_scorer.py`

- [ ] **Step 1: Write the failing tests**

`healthflow/evals/tests/test_scorer.py`:
```python
from healthflow.evals.translate.judge import JudgeVerdict
from healthflow.evals.translate.loader import EvalCase
from healthflow.evals.translate.runner import AgentRun
from healthflow.evals.translate.scorer import CaseScore, detect_abstention, score
from healthflow.models.schemas import DocumentSection

SECTIONS = [DocumentSection(title="ER", content="copay $120")]


def _case(answerable, amounts=(), gold="$120"):
    return EvalCase(
        id="c", sections=SECTIONS, question="q?", answerable=answerable,
        expect_amounts=list(amounts), gold_answer=gold if answerable else None,
    )


def test_detect_abstention_true_on_markers():
    assert detect_abstention("That is not in the document.") is True
    assert detect_abstention("The document doesn't contain that information.") is True


def test_detect_abstention_false_on_real_answer():
    assert detect_abstention("Your ER copay is $120, waived if admitted.") is False


def test_unanswerable_passes_when_agent_abstains():
    run = AgentRun(_case(False), "That isn't in the document.")
    s = score(run, None)
    assert isinstance(s, CaseScore)
    assert s.abstained is True
    assert s.passed is True
    assert s.faithful is None  # judge not run for unanswerable


def test_unanswerable_fails_when_agent_invents_answer():
    run = AgentRun(_case(False), "Dental implants are fully covered.")
    s = score(run, None)
    assert s.abstained is False
    assert s.passed is False


def test_answerable_passes_when_amounts_present_and_judge_clean():
    run = AgentRun(_case(True, amounts=[120]), "Your ER copay is $120.")
    verdict = JudgeVerdict(faithful=True, hallucinated=False, contradicts_gold=False, rationale="ok")
    s = score(run, verdict)
    assert s.amounts_present is True
    assert s.passed is True


def test_answerable_fails_when_amount_missing():
    run = AgentRun(_case(True, amounts=[120]), "Your ER copay is some dollars.")
    verdict = JudgeVerdict(faithful=True, hallucinated=False, contradicts_gold=False, rationale="ok")
    s = score(run, verdict)
    assert s.amounts_present is False
    assert s.passed is False


def test_answerable_fails_on_hallucination():
    run = AgentRun(_case(True, amounts=[120]), "Your ER copay is $120 and dental is free.")
    verdict = JudgeVerdict(faithful=False, hallucinated=True, contradicts_gold=False, rationale="invented dental")
    s = score(run, verdict)
    assert s.passed is False


def test_answerable_with_no_expected_amounts_is_vacuously_present():
    run = AgentRun(_case(True, amounts=[]), "Cleanings are covered once a year.")
    verdict = JudgeVerdict(faithful=True, hallucinated=False, contradicts_gold=False, rationale="ok")
    s = score(run, verdict)
    assert s.amounts_present is True
    assert s.passed is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_scorer.py -v`
Expected: FAIL — module `scorer` not found.

- [ ] **Step 3: Write the scorer**

`healthflow/evals/translate/scorer.py`:
```python
from __future__ import annotations

import re
from dataclasses import dataclass

from healthflow.evals.translate.judge import JudgeVerdict
from healthflow.evals.translate.runner import AgentRun

# Documented, tunable set of phrases that signal the agent declined to answer
# because the document didn't contain the information.
ABSTENTION_MARKERS = (
    "not in the document",
    "not in this document",
    "doesn't contain",
    "does not contain",
    "isn't in the document",
    "is not in the document",
    "unable to determine",
    "cannot determine",
    "no information",
    "not specified",
)


@dataclass(frozen=True)
class CaseScore:
    case_id: str
    answerable: bool
    abstained: bool
    amounts_present: bool
    faithful: bool | None
    hallucinated: bool | None
    contradicts_gold: bool | None
    passed: bool


def detect_abstention(answer: str) -> bool:
    low = answer.lower()
    return any(marker in low for marker in ABSTENTION_MARKERS)


def _amounts_present(answer: str, expected: list[int]) -> bool:
    if not expected:
        return True
    found = {int(n) for n in re.findall(r"\$?\s*(\d[\d,]*)", answer.replace(",", ""))}
    return all(amount in found for amount in expected)


def score(run: AgentRun, verdict: JudgeVerdict | None) -> CaseScore:
    case = run.case
    abstained = detect_abstention(run.answer)

    if not case.answerable:
        return CaseScore(
            case_id=case.id, answerable=False, abstained=abstained,
            amounts_present=False, faithful=None, hallucinated=None,
            contradicts_gold=None, passed=abstained,
        )

    amounts_present = _amounts_present(run.answer, case.expect_amounts)
    faithful = None if verdict is None else verdict.faithful
    hallucinated = None if verdict is None else verdict.hallucinated
    contradicts = None if verdict is None else verdict.contradicts_gold
    passed = bool(
        amounts_present and faithful and not hallucinated and not contradicts
    )
    return CaseScore(
        case_id=case.id, answerable=True, abstained=abstained,
        amounts_present=amounts_present, faithful=faithful,
        hallucinated=hallucinated, contradicts_gold=contradicts, passed=passed,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_scorer.py -v`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals/translate/scorer.py healthflow/evals/tests/test_scorer.py
git commit -m "feat(evals): hybrid per-case scorer + abstention detector"
```

---

### Task 6: Report — aggregate scores into metrics + render

**Files:**
- Create: `healthflow/evals/translate/report.py`
- Test: `healthflow/evals/tests/test_report.py`

- [ ] **Step 1: Write the failing tests**

Rates are `float | None`; a rate is `None` when its category has zero cases
(honest "n/a" rather than a misleading 0 or 1).

`healthflow/evals/tests/test_report.py`:
```python
import json

from healthflow.evals.translate.report import EvalReport, aggregate, render_summary, write_report
from healthflow.evals.translate.scorer import CaseScore


def _answerable(passed, faithful=True, hallucinated=False):
    return CaseScore(
        case_id="a", answerable=True, abstained=False, amounts_present=True,
        faithful=faithful, hallucinated=hallucinated, contradicts_gold=False, passed=passed,
    )


def _unanswerable(abstained):
    return CaseScore(
        case_id="u", answerable=False, abstained=abstained, amounts_present=False,
        faithful=None, hallucinated=None, contradicts_gold=None, passed=abstained,
    )


def test_aggregate_computes_rates():
    scores = [
        _answerable(passed=True, faithful=True, hallucinated=False),
        _answerable(passed=False, faithful=False, hallucinated=True),
        _unanswerable(abstained=True),
        _unanswerable(abstained=False),
    ]
    r = aggregate(scores)
    assert isinstance(r, EvalReport)
    assert r.faithfulness_rate == 0.5      # 1 of 2 answerable faithful
    assert r.hallucination_rate == 0.5     # 1 of 2 answerable hallucinated
    assert r.abstention_accuracy == 0.5    # 1 of 2 unanswerable abstained
    assert r.pass_rate == 0.5              # 2 of 4 passed
    assert len(r.cases) == 4


def test_aggregate_rate_is_none_for_empty_category():
    r = aggregate([_unanswerable(abstained=True)])  # no answerable cases
    assert r.faithfulness_rate is None
    assert r.hallucination_rate is None
    assert r.abstention_accuracy == 1.0
    assert r.pass_rate == 1.0


def test_render_summary_mentions_metrics():
    r = aggregate([_answerable(passed=True)])
    out = render_summary(r)
    assert "pass" in out.lower()
    assert "faithful" in out.lower()


def test_write_report_writes_json(tmp_path):
    r = aggregate([_answerable(passed=True), _unanswerable(abstained=True)])
    path = tmp_path / "report.json"
    write_report(r, path)
    data = json.loads(path.read_text())
    assert data["pass_rate"] == 1.0
    assert len(data["cases"]) == 2
    assert data["cases"][0]["case_id"] == "a"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_report.py -v`
Expected: FAIL — module `report` not found.

- [ ] **Step 3: Write the report module**

`healthflow/evals/translate/report.py`:
```python
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from healthflow.evals.translate.scorer import CaseScore


@dataclass(frozen=True)
class EvalReport:
    faithfulness_rate: float | None
    abstention_accuracy: float | None
    hallucination_rate: float | None
    pass_rate: float | None
    cases: list[CaseScore]


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator / denominator, 3)


def aggregate(scores: list[CaseScore]) -> EvalReport:
    answerable = [s for s in scores if s.answerable]
    unanswerable = [s for s in scores if not s.answerable]
    return EvalReport(
        faithfulness_rate=_rate(sum(1 for s in answerable if s.faithful), len(answerable)),
        hallucination_rate=_rate(sum(1 for s in answerable if s.hallucinated), len(answerable)),
        abstention_accuracy=_rate(sum(1 for s in unanswerable if s.abstained), len(unanswerable)),
        pass_rate=_rate(sum(1 for s in scores if s.passed), len(scores)),
        cases=list(scores),
    )


def _fmt(rate: float | None) -> str:
    return "n/a" if rate is None else f"{rate:.1%}"


def render_summary(report: EvalReport) -> str:
    lines = [
        "Translate accuracy benchmark",
        "============================",
        f"  pass rate           : {_fmt(report.pass_rate)}",
        f"  faithfulness        : {_fmt(report.faithfulness_rate)}",
        f"  hallucination rate  : {_fmt(report.hallucination_rate)}",
        f"  abstention accuracy : {_fmt(report.abstention_accuracy)}",
        "",
    ]
    for c in report.cases:
        flag = "PASS" if c.passed else "FAIL"
        lines.append(f"  [{flag}] {c.case_id}")
    return "\n".join(lines)


def write_report(report: EvalReport, path: Path) -> None:
    payload = {
        "faithfulness_rate": report.faithfulness_rate,
        "abstention_accuracy": report.abstention_accuracy,
        "hallucination_rate": report.hallucination_rate,
        "pass_rate": report.pass_rate,
        "cases": [asdict(c) for c in report.cases],
    }
    Path(path).write_text(json.dumps(payload, indent=2))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/test_report.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals/translate/report.py healthflow/evals/tests/test_report.py
git commit -m "feat(evals): report aggregation + JSON/summary rendering"
```

---

### Task 7: Live entrypoint + `make eval`

**Files:**
- Create: `healthflow/evals/translate/run.py`
- Modify: `Makefile`

- [ ] **Step 1: Write the entrypoint**

Not unit-tested (it's the live orchestrator that hits real APIs; the units it
calls are all tested). It guards on `LIVE_EVAL=1` and a present `ANTHROPIC_API_KEY`.

`healthflow/evals/translate/run.py`:
```python
from __future__ import annotations

import os
import sys
from pathlib import Path

import anthropic

from healthflow.agents.translation_agent import TranslationAgent
from healthflow.evals.translate.judge import judge
from healthflow.evals.translate.loader import load_cases
from healthflow.evals.translate.report import aggregate, render_summary, write_report
from healthflow.evals.translate.runner import run_case
from healthflow.evals.translate.scorer import score

_HERE = Path(__file__).parent
CASES_PATH = _HERE / "cases.yaml"
REPORT_PATH = _HERE / "report.json"


def main() -> int:
    if os.getenv("LIVE_EVAL") != "1":
        print("Refusing to run: set LIVE_EVAL=1 (this calls the live Anthropic API). "
              "Use `make eval`.", file=sys.stderr)
        return 2
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        return 2

    cases = load_cases(CASES_PATH)
    agent = TranslationAgent()
    client = anthropic.Anthropic()

    scores = []
    for case in cases:
        run = run_case(agent, case)
        verdict = None
        if case.answerable:
            verdict = judge(client, case.sections, case.question, case.gold_answer, run.answer)
        scores.append(score(run, verdict))

    report = aggregate(scores)
    write_report(report, REPORT_PATH)
    print(render_summary(report))
    print(f"\nWrote {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Verify the guard works without an API key**

Run: `.venv/bin/python -m healthflow.evals.translate.run`
Expected: prints the `LIVE_EVAL=1` refusal to stderr, exit code 2 (no API call).

- [ ] **Step 3: Add the `make eval` target**

Modify `Makefile` — add after the `smoke-external` target:
```
eval: ## Run the translate accuracy benchmark (live; needs ANTHROPIC_API_KEY)
	LIVE_EVAL=1 .venv/bin/python -m healthflow.evals.translate.run
```

- [ ] **Step 4: Verify the target is wired**

Run: `make -n eval`
Expected: prints `LIVE_EVAL=1 .venv/bin/python -m healthflow.evals.translate.run`.

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals/translate/run.py Makefile
git commit -m "feat(evals): live entrypoint + make eval target"
```

---

### Task 8: Author the gold dataset (real SoB documents)

**Files:**
- Create: `healthflow/evals/translate/fixtures/<plan-slug>.md` (1–2 files)
- Create: `healthflow/evals/translate/fixtures/provenance.md`
- Create: `healthflow/evals/translate/cases.yaml`

> **Note:** This task requires obtaining 1–2 real, public Medicare Advantage
> Summary-of-Benefits documents (no PHI — public marketing material). If the user
> named a preferred carrier/plan, use it; otherwise pick a well-known public plan.
> Confirm the source with the user before authoring if unsure.

- [ ] **Step 1: Source and extract the document(s)**

Obtain the public Summary of Benefits PDF(s). For each, extract the relevant
sections (emergency care, prescription drugs, deductible/out-of-pocket, dental/
out-of-network) into `fixtures/<plan-slug>.md`, one `## Heading` per section,
preserving the real dollar figures and conditions. Example shape:
```markdown
## Emergency Care
Emergency room visits: $120 copay per visit. The copay is waived if you are
admitted to the hospital within 24 hours for the same condition.

## Outpatient Prescription Drugs
Tier 1 (preferred generic): $0 copay. Tier 2 (generic): $10 copay ...
```

- [ ] **Step 2: Record provenance**

`fixtures/provenance.md`:
```markdown
# Fixture provenance

These are excerpts of public Medicare Advantage Summary of Benefits documents
(public marketing material; no PHI). Each is quoted for benchmarking only.

- `<plan-slug>.md` — <Plan name>, <year>. Source: <URL>. Retrieved <date>.
```

- [ ] **Step 3: Author the cases**

`cases.yaml` — ~15–20 cases against the fixtures, with verified answers.
Include answerable cases (some with `expect_facts.amounts`), tricky cases
(waived-if-admitted), and `answerable: false` cases the agent must abstain on:
```yaml
- id: er-copay-admitted
  doc: <plan-slug>
  question: "What's my ER copay if I'm admitted?"
  answerable: true
  expect_facts:
    amounts: [120]
  gold_answer: >
    The ER copay is $120, but it is waived if you are admitted within 24 hours.

- id: cosmetic-surgery
  doc: <plan-slug>
  question: "Is cosmetic surgery covered?"
  answerable: false
```

- [ ] **Step 4: Verify the dataset loads**

Run: `.venv/bin/python -c "from pathlib import Path; from healthflow.evals.translate.loader import load_cases; cs = load_cases(Path('healthflow/evals/translate/cases.yaml')); print(len(cs), 'cases', sum(c.answerable for c in cs), 'answerable')"`
Expected: prints the case count and answerable count; no exceptions (proves every
`doc` resolves, ids are unique, fields parse).

- [ ] **Step 5: Commit**

```bash
git add healthflow/evals/translate/fixtures healthflow/evals/translate/cases.yaml
git commit -m "feat(evals): gold dataset — real SoB fixtures + translate cases"
```

---

### Task 9: Full-suite check + run the live benchmark

**Files:** none (verification).

- [ ] **Step 1: Run the eval unit suite**

Run: `.venv/bin/python -m pytest healthflow/evals/tests/ -v`
Expected: all tests PASS (loader, judge, runner, scorer, report).

- [ ] **Step 2: Confirm no regressions in the broader suite**

Run: `make test`
Expected: the full backend suite passes, now including `healthflow/evals/tests/`.

- [ ] **Step 3: Run the live benchmark (optional, costs tokens)**

With `ANTHROPIC_API_KEY` set:
Run: `make eval`
Expected: prints the metrics summary (pass rate, faithfulness, hallucination
rate, abstention accuracy) and writes `healthflow/evals/translate/report.json`.
This is the first real accuracy number for the translate agent.

- [ ] **Step 4: Add report.json to .gitignore**

The live report is a run artifact, not source. Append to `.gitignore`:
```
healthflow/evals/translate/report.json
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore(evals): ignore the generated benchmark report"
```
