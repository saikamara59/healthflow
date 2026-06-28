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
    "isn't in the document",
    "is not in the document",
    "document doesn't contain",
    "document does not contain",
    "not contain that information",
    "not contain information",
    "unable to answer",
    "cannot answer",
    "can't answer",
    "not available in the document",
    "document doesn't address",
    "document does not address",
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
    found = {int(n) for n in re.findall(r"\$?\s*(\d+)", answer.replace(",", ""))}
    return all(amount in found for amount in expected)


def score(run: AgentRun, verdict: JudgeVerdict | None) -> CaseScore:
    case = run.case
    if case.answerable and verdict is None:
        raise ValueError(f"answerable case {case.id!r} requires a judge verdict")
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
