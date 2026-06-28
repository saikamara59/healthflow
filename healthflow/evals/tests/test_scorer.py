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
