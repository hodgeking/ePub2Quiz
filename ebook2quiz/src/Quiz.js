import './Quiz.css';
import html2canvas from 'html2canvas';

function Quiz({questions, selectedAnswers, onAnswer, submitted, setSubmitted, selectedHrefsArray,
                  rendition, closeQuiz, searchSentence, setShowToc, searchValid, model, totalTokens})
{

    function handleAnswer(questionIndex, selectedOption) {
        onAnswer(questionIndex, selectedOption); // update selected answers (in state of Reader)
    }

    function handleSubmit() { // saves submitted state in Reader
        setSubmitted(true);
    }

    function handleExportQuiz() { // if json is needed; currently using TSV instead
        const dataStr = JSON.stringify({questions, selectedAnswers, submitted});
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const exportFileDefaultName = 'quiz.json';
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = exportFileDefaultName;
        link.click();
    }

    function handleDownloadScreenshot() { // download quiz as image
        const quizElement = document.querySelector('.quiz-content');
        html2canvas(quizElement).then(canvas => {
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = 'quiz_screenshot.png';
            link.click();
        });
    }

    // check if href given by LM is actually in the book
    function isValidHref(href) {
        return selectedHrefsArray.includes(href);
    }

    function handleExportQuizTSV() {
        const tsvContent = questions.map((question, index) => {
            const options = Object.entries(question.options).map(([key, value]) => `${key}: ${value}`).join('; ');
            return `${index + 1}\t${question.question}\t${options}\t${question.correct_answer}\t${question.explanation}\t${question.answer_location}\t${question.href}\t${model}`;
        }).join('\n');

        const header = 'Question Number\tQuestion\tOptions\tCorrect Answer\tExplanation\tAnswer Location\tReference\tModel\n';
        const tsv = header + tsvContent;

        const dataUri = 'data:text/tsv;charset=utf-8,' + encodeURIComponent(tsv);
        const exportFileDefaultName = 'quiz.tsv';
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = exportFileDefaultName;
        link.click();
    }

    return (<div className='quiz'>
            {/*<button onClick={handleExportQuiz} className="export" style={{marginRight: '10px', zIndex:10000}}>Download Quiz as JSON</button>*/}
            <button onClick={handleDownloadScreenshot} className='download-screenshot'
                    style={{marginRight: '10px'}}>Download Quiz as Image
            </button>
            <button onClick={handleExportQuizTSV} className='export-csv'>Download Quiz as TSV</button>
            <div className='quiz-content' style={{padding: '15px'}}>
                <p>Model: {model}</p>
                <p>Total Tokens: {totalTokens}</p>
                {questions.map((question, index) => ( // go through questions
                    <div key={index} className='question'>
                        <p><strong>{index + 1}. {question.question}</strong></p> {/* question text */}
                        {Object.entries(question.options).map(([option, text]) => ( // go through options
                            <div key={option} className='option'>
                                <input
                                    type='radio' // only one option can be selected
                                    id={`${index}-${option}`} // unique id
                                    name={index}
                                    value={option} // option text
                                    onChange={() => handleAnswer(index, option)}
                                    disabled={submitted}
                                    checked={selectedAnswers[index] === option} // set checked attribute based on selectedAnswers state (so it is saved when closing and reopening)
                                />
                                <label
                                    htmlFor={`${index}-${option}`}>{`${option}) ${text}`}</label> {/* without this, clicking on option would not select button*/}
                            </div>))}
                        {submitted && (// class name depends on whether the answer is correct or incorrect (so we can have color coding)
                            <div
                                className={`result ${selectedAnswers[index] === question.correct_answer[0] ? 'correct' : 'incorrect'}`}>
                                <p>
                                    <strong>{selectedAnswers[index] === question.correct_answer[0] ? 'Correct' : 'Incorrect'}</strong>
                                </p>
                                <p>Correct answer: {question.correct_answer[0]}</p>
                                <p>Your answer: {selectedAnswers[index]}</p>
                                {question.explanation &&
                                    <p>Explanation: {question.explanation}</p>} {/* conditional rendering in case we remove it later from the prompt (remove from backend check in app.py as well)*/}
                                {isValidHref(question.href) && (<button onClick={() => {
                                        rendition.display(question.href);
                                        closeQuiz();
                                    }}>Open Chapter</button>)}
                                <button
                                    style={{
                                        display: searchValid[index] ? 'inline-block' : 'none', marginLeft: '5px'
                                    }}
                                    onClick={() => {
                                        searchSentence(question.answer_location.replace(/[.,;]+$/gm, ''), question.href) // search for sentence, priority to chapter given by LM (remove punct at end)
                                            .then((success) => {
                                                if (success) {
                                                    closeQuiz(); // close quiz modal to show reader
                                                    setShowToc(false); // hide TOC so we can see the search result
                                                } else {
                                                    // answer location not found; either not in the book or search does not work properly
                                                    console.log('answer location not found in the book')
                                                }
                                            })
                                            .catch((error) => {
                                                console.error('error while searching sentence', error);
                                            });
                                    }}> Show Answer Location
                                </button>
                            </div>)}
                    </div>))}
            </div>
            {!submitted && <button onClick={handleSubmit} className='submit'>Submit</button>}
        </div>);
}

export default Quiz;