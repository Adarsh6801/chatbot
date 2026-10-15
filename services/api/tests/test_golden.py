import json
from pathlib import Path
from types import SimpleNamespace
from services.api.rag import embed, retrieve, extractive_answer

def test_fifty_question_retrieval_regression_gate():
    golden = json.loads((Path(__file__).parents[1] / 'evals/golden.json').read_text())
    chunks = [SimpleNamespace(id=id, content=text, embedding=embed(text)) for id,text in golden['sources'].items()]
    failures=[]
    for question, expected_id, phrase in golden['questions']:
        hits=retrieve(question,chunks)
        answer=extractive_answer(question,hits)
        if hits[0]['chunk'].id != expected_id or phrase.lower() not in answer.lower(): failures.append(question)
    assert len(golden['questions']) == 50
    assert len(failures) <= 5, f'Golden quality gate below 90%: {failures}'
