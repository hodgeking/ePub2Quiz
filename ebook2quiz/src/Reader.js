import React, {useState, useEffect, useRef} from 'react';
import {ReactReader} from 'react-reader';
import axios from 'axios';
import Modal from 'react-modal';
import Quiz from './Quiz.js';
import './Reader.css';
import LoadingIcons from 'react-loading-icons';
import {useNavigate} from 'react-router-dom';


function Reader({fileUrl}) {
    const [location,] = useState(null); // current location of the reader, not used for now but could be useful for future features
    const [toc, setToc] = useState([]); // store table of contents
    const [showToc, setShowToc] = useState(true); // toggle visibility of table of contents
    const [rendition, setRendition] = useState(null); // store rendition instance
    const [selectedChapters, setSelectedChapters] = useState({});
    const [isLoading, setIsLoading] = useState(false); // track whether something is loading
    const [quizQuestions, setQuizQuestions] = useState(null); // store generated quiz questions
    const [quizOpen, setQuizOpen] = useState(false); // toggle visibility of quiz
    const [selectedAnswers, setSelectedAnswers] = useState([]);
    const [submitted, setSubmitted] = useState(false);
    const [questionCount, setQuestionCount] = useState(5); // default to 5 questions
    const [questionCountModalOpen, setQuestionCountModalOpen] = useState(false);
    const [errorOpen, setErrorOpen] = useState(false);
    const [selectedHrefsArray, setSelectedHrefsArray] = useState([]); // store selected chapters
    const [searchValid, setSearchValid] = useState([]); // store if questions have valid locations
    const [model, setModel] = useState(null); // model name used for quiz
    const [totalTokens, setTotalTokens] = useState(null); // token amount for current quiz

    // open and close quiz modal
    function openQuiz() {
        setQuizOpen(true);
    }

    function closeQuiz() {
        setQuizOpen(false);
    }

    // reset when new questions are generated
    function resetQuiz() {
        setSelectedAnswers([]);
        setSubmitted(false);
    }

    // handle answer quiz questions
    function handleAnswer(index, option) {
        const newSelectedAnswers = [...selectedAnswers];
        newSelectedAnswers[index] = option;
        setSelectedAnswers(newSelectedAnswers);
    }

    function handleTocChange(newToc) {
        setToc(newToc);
    }

    function toggleToc() { // change showToc state to opposite
        setShowToc(!showToc);
    }


    function onChapterSelect(href, isSelected, subitems = []) {
        // default value is for cases when there's no subitems
        // open selected chapter if isSelected is true
        if (isSelected) {
            rendition.display(href);
        }

        const newSelectedChapters = {...selectedChapters, [href]: isSelected};

        // update selected state of all subchapters
        function updateSubchapters(subitems) {
            subitems.forEach(subitem => {
                newSelectedChapters[subitem.href] = isSelected; // set selected state of subchapter to match parent
                if (subitem.subitems) { // if subchapter has subchapters, update their selected state as well
                    updateSubchapters(subitem.subitems);
                }
            });
        }

        updateSubchapters(subitems); // call function to update selected state of subchapters

        setSelectedChapters(newSelectedChapters); // update selected chapters state in Reader component
    }


    // handle question count
    function handleGenerateQuizClick() {
        setQuestionCountModalOpen(true);
    }

    // if question count is submitted, close modal and submit chapters
    function handleQuestionCountSubmit() {
        setQuestionCountModalOpen(false);
        submitChapters();
    }


    // submit selected chapters and send POST request to generate quiz
    async function submitChapters() {
        // if selected chapters has no true values, return, aka do nothing
        if (!Object.values(selectedChapters).includes(true)) {
            return;
        }

        setIsLoading(true); // make loading screen visible

        // filter selected chapters
        const selected = Object.entries(selectedChapters).filter(([href, isSelected]) => isSelected);

        // return hrefs of selected chapters
        const selectedHrefs = selected.map(([href]) => href);
        setSelectedHrefsArray(selectedHrefs);

        // reset quiz
        resetQuiz();

        // send POST request with selected chapters
        try {
            const response = await axios.post('/api/generate_quiz', {
                selectedChapters: selectedHrefs, ebookUrl: fileUrl, numQuestions: questionCount, toc: toc
            });
            setQuizQuestions(response.data.questions); // access questions from response (generated quiz questions in backend)

            setQuizOpen(true); // open quiz modal

            // validate if quizQuestions have valid locations (searchSentence
            // returns boolean whether location is found in book)
            const searchResults = await Promise.all(response.data.questions.map(question => searchSentence(question.answer_location)));

            setSearchValid(searchResults); // store search results in state

            // set model name
            setModel(response.data.model_used);

            // set token number
            setTotalTokens(response.data.total_tokens);

        } catch (error) {
            console.error('Error:', error);
            setErrorOpen(true); // if some error is thrown, open modal to notify user (oops ..)
        } finally {
            setIsLoading(false); // end loading
            clearHighlights(); // remove highlights (from search for valid locations)
        }

        return selectedHrefs;
    }

    // makes sure that user can only input values between min and max
    function handleQuestionCountChange(e, min, max) {
        let value = e.target.value;

        if (value < min) {
            value = min
        } else if (value > max) {
            value = max;
        }
        setQuestionCount(value); // set question count to min or max if out of allowed range
    }

    const renditionRef = useRef(null); // reference to rendition; not state since it doesn't need to trigger rerender
    const bookRef = useRef(null); // reference to book; not state since it doesn't need to trigger rerender
    const [searchResults, setSearchResults] = useState([]); // to store search results
    const [currentResultIndex, setCurrentResultIndex] = useState(0); // to store current search result index

    // doSearch adapted from:
    // https://github.com/futurepress/epub.js/wiki/Tips-and-Tricks-(v0.3)#searching-the-entire-book
    function doSearch(q, chapterHref = null) {
        const book = bookRef.current;
        if (!book) return Promise.resolve([]); // if book not loaded, return empty array

        // search for q in whole book
        // this function needs improvement; currently it does not work when sentence includes inline html elements in epub
        function searchWholeBook() {
            return Promise.all(book.spine.spineItems.map((item) => item.load(book.load.bind(book)) // load chapter
                /*.then((loadedItem) => {
                console.log(item); // log loaded chapter; there is a 'href' property; maybe for href based search?
                console.log(loadedItem); // log loaded item; there is an 'textContent' property
                console.log(loadedItem.textContent); // log text content of loaded item
            })*/
                .then(item.find.bind(item, q)) // find q in item
                .finally(item.unload.bind(item)) // unload chapter (memory)
            )).then((results) => Promise.resolve([].concat.apply([], results)));
        }

        // check if chapter exists
        const chapterItem = book.spine.get(chapterHref); // returns undefined if not found
        if (chapterItem) {
            return chapterItem.load(book.load.bind(book))
                .then(chapterItem.find.bind(chapterItem, q)) // find q in given chapter; make sure its loaded first since error when searching otherwise
                .finally(chapterItem.unload.bind(chapterItem))
                .then((chapterResults) => {
                    if (chapterResults.length > 0) {
                        // return results if found
                        return Promise.resolve(chapterResults);
                    } else {
                        // if no results, search whole book (maybe LLM failed to give correct location)
                        return searchWholeBook();
                    }
                });
        } else {
            // if no chapterHref, or it doesn't exist, search all chapters
            return searchWholeBook();
        }
    }

    // annotation (highlight) functionality adapted from:
    // https://github.com/gerhardsletten/react-reader/blob/HEAD/src/examples/Selection.tsx
    async function searchSentence(sentence, chapterHref = null) { // search for sentence and highlight it
        clearHighlights(); // delete previous highlighted text
        setSearchResults([]);

        try {
            const results = await doSearch(sentence, chapterHref);
            setSearchResults(results); // store search results in state
            if (results.length > 0) {
                const location = results[0].cfi; // get first result
                if (renditionRef.current) {
                    renditionRef.current.display(location); // display location in reader
                    setCurrentResultIndex(0);

                    // add highlight annotation
                    renditionRef.current.annotations.add('highlight', location, {}, undefined, 'hl', {
                        fill: 'yellow',
                        'fill-opacity': '0.3',
                        'mix-blend-mode': 'multiply'
                    });
                }
                return true; // results found
            } else {
                return false; // no results found
            }
        } catch (error) {
            console.error('error searching for sentence:', error);
            return false; // error, no results
        }
    }


    function goToNextResult() {
        if (searchResults.length > 0) { // if something found
            const nextIndex = (currentResultIndex + 1) % searchResults.length; // get next index
            const location = searchResults[nextIndex].cfi; // get location of next index
            if (renditionRef.current) {
                clearHighlights(); // remove highlighted text

                renditionRef.current.display(location);  // show location in reader
                setCurrentResultIndex(nextIndex);

                // add new highlight
                renditionRef.current.annotations.add('highlight', location, {}, undefined, 'hl', {
                    fill: 'yellow',
                    'fill-opacity': '0.3',
                    'mix-blend-mode': 'multiply'
                });
            }
        }
    }

    function goToPreviousResult() {
        if (searchResults.length > 0) {
            const previousIndex = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
            const location = searchResults[previousIndex].cfi;
            if (renditionRef.current) {
                clearHighlights(); // remove highlighted text

                renditionRef.current.display(location);
                setCurrentResultIndex(previousIndex);

                // add new highlight
                renditionRef.current.annotations.add('highlight', location, {}, undefined, 'hl', {
                    fill: 'yellow',
                    'fill-opacity': '0.3',
                    'mix-blend-mode': 'multiply'
                });
            }
        }
    }

    // clear all highlights
    function clearHighlights() {
        if (renditionRef.current && renditionRef.current.annotations && renditionRef.current.annotations._annotations) {
            const annotations = renditionRef.current.annotations._annotations;
            Object.keys(annotations).forEach((cfiRange) => {
                if (annotations[cfiRange].type === 'highlight') {
                    renditionRef.current.annotations.remove(annotations[cfiRange].cfiRange, 'highlight');
                }
            });
        }
    }

    const navigate = useNavigate(); // to navigate to other page on website (here used to return to upload page)

    return (<div>
            <div style={{position: 'relative'}}>
                {/* return to homepage button */}
                <button style={{
                    margin: 10,
                    backgroundColor: 'white',
                    padding: 4,
                    borderStyle: 'solid',
                    borderColor: '#c2c2c2',
                    borderRadius: '3px',
                    borderWidth: '1px'
                }} onClick={() => navigate('/')}>
                    Return to Upload Page
                </button>
                {/* TOC toggle button*/}
                <button className='button' style={{margin: '10px', right: 20, position: 'fixed', zIndex: 100}}
                        onClick={toggleToc}>
                    {showToc ? 'Hide TOC' : 'Show TOC'}
                </button>
            </div>
            <div style={{position: 'absolute', height: '90%', width: '100%', zIndex: 4}}>
                {/* displays ePub */}
                <ReactReader
                    location={location}
                    tocChanged={handleTocChange}
                    url={fileUrl}
                    showToc={true}
                    getRendition={(rendition) => {
                        renditionRef.current = rendition;
                        setRendition(rendition);
                        rendition.book.ready.then(() => {
                            bookRef.current = rendition.book;
                        });
                    }}
                />
                <div style={{
                    position: 'fixed', bottom: 20, left: 20, zIndex: 5
                }}> {/* search bar */}
                    <input
                        type='text'
                        placeholder='Search in eBook'
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                searchSentence(e.target.value); // search when enter is pressed
                            }
                        }}
                    />
                    <button style={{marginLeft: 5}}
                            onClick={() => searchSentence(document.querySelector('input').value)}>
                        Search
                    </button>
                    <button style={{margin: 5}} onClick={goToPreviousResult} disabled={searchResults.length === 0}>
                        Previous
                    </button>
                    <button onClick={goToNextResult} disabled={searchResults.length === 0}>
                        Next
                    </button>
                </div>
                <div>
                    {/* table of contents */}
                    <div style={{display: showToc ? 'block' : 'none'}}>
                        <TableOfContents toc={toc} onChapterSelect={onChapterSelect}/>
                    </div>

                    <div style={{
                        position: 'fixed', bottom: 20, right: 20, zIndex: 5
                    }}> {/* quiz button to open quiz interface */}
                        <button className='button' style={{display: quizQuestions ? 'inline-block' : 'none'}}
                                onClick={openQuiz}>Open Quiz
                        </button>
                        {/* show button only if quiz questions exist */}
                        <button className='button' onClick={handleGenerateQuizClick}>Generate Quiz with Selected
                            Chapters
                        </button>
                        <Modal
                            isOpen={questionCountModalOpen}
                            onRequestClose={() => setQuestionCountModalOpen(false)}
                            style={{
                                overlay: {zIndex: 1000}, content: {
                                    position: 'absolute',
                                    top: '50%',
                                    left: '50%',
                                    right: 'auto',
                                    bottom: 'auto',
                                    transform: 'translate(-50%, -50%)',
                                    borderRadius: '10px',
                                }
                            }}
                        >
                            <label>
                                {/* warning for user if new quiz is created in case there is one already*/}
                                {quizQuestions !== null && (
                                    <p style={{color: 'red'}}>Attention: the old quiz will be deleted.</p>)}
                                <p> How many questions do you want to generate? (1-10) <br/></p>
                                {/* range/slider is also possible (but not recommended if exact value is important*/}
                                <input type='number' value={questionCount}
                                       onChange={(e) => handleQuestionCountChange(e, 1, 10)} min='1' max='10'/>
                            </label>
                            <button style={{marginLeft: 5}} onClick={handleQuestionCountSubmit}>Submit</button>
                        </Modal>
                    </div>
                </div>
                {/* quiz modal with questions, answers etc*/}
                <Modal
                    isOpen={quizOpen}
                    onRequestClose={closeQuiz}
                    style={{overlay: {zIndex: 1000}}}>
                    <button className='button close' onClick={closeQuiz}
                            style={{position: 'fixed', top: 50, right: 50, fontSize: '1.5em'}}>&times;</button>
                    {quizQuestions && <Quiz questions={quizQuestions} selectedAnswers={selectedAnswers}
                                            onAnswer={handleAnswer} submitted={submitted}
                                            setSubmitted={setSubmitted} rendition={rendition}
                                            selectedHrefsArray={selectedHrefsArray} closeQuiz={closeQuiz}
                                            searchSentence={searchSentence} setShowToc={setShowToc}
                                            searchValid={searchValid} model={model} totalTokens={totalTokens}/>}
                </Modal>
                {/* loading modal */}
                <Modal
                    isOpen={isLoading}
                    shouldCloseOnOverlayClick={false}
                    shouldCloseOnEsc={false}
                    style={{
                        overlay: {zIndex: 1000}, content: {
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            right: 'auto',
                            bottom: 'auto',
                            marginRight: '-50%',
                            transform: 'translate(-50%, -50%)',
                            width: '200px',
                            height: '100px',
                            textAlign: 'center'
                        }
                    }}>
                    <div>
                        Generating Questions.. <br/> This might take a while :) <br/> <br/>
                        <LoadingIcons.Oval stroke='#1e80d9'/>
                    </div>
                </Modal>
                {/* error modal */}
                <Modal
                    isOpen={errorOpen}
                    onRequestClose={() => setErrorOpen(false)}
                    style={{
                        overlay: {zIndex: 1001}, content: {
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            right: 'auto',
                            bottom: 'auto',
                            marginRight: '-50%',
                            transform: 'translate(-50%, -50%)',
                            width: '300px',
                            height: '100px',
                            textAlign: 'center'
                        }
                    }}>
                    <p>Oops! Something went wrong. <br/>Please try again (possibly with fewer chapters). </p>
                    <button onClick={() => setErrorOpen(false)}>Close</button>
                </Modal>
            </div>
        </div>);
}


function TableOfContents({toc, onChapterSelect}) { // toc is provided as prop extracted from Reader
    return (<div style={{
            position: 'absolute', right: 0, // replace with left if it should be on left side
            top: 25, height: '80%', width: 'auto', maxWidth: '40%', // so it doesn't take up the whole screen if chapters have too long names
            overflow: 'auto', backgroundColor: 'rgb(212,223,232)', // maybe reduce opacity later? (last number)
            borderRight: '1px solid black', padding: '10px', borderRadius: '10px', // rounded corners
            paddingBottom: '10px', zIndex: 2
        }}>
            <div style={{
                position: 'sticky', top: 0, backgroundColor: 'white'
            }}>
            </div>
            {/* for each element in toc (chapter), create a component Chapter*/}
            {toc.map(chapter => (<Chapter key={chapter.id} chapter={chapter} onChapterSelect={onChapterSelect}/>))}
        </div>)

}

function Chapter({chapter, onChapterSelect, level = 0, parentSelected = false}) {
    const [isSelected, setIsSelected] = useState(false);
    const [showSubchapters, setShowSubchapters] = useState(false);

    // update isSelected state when parentSelected changes
    useEffect(() => {
        setIsSelected(parentSelected);
    }, [parentSelected]);

    function handleSelect() {
        const newIsSelected = !isSelected; // we could also use !isSelected directly but this is more readable
        setIsSelected(newIsSelected);
        onChapterSelect(chapter.href, newIsSelected, chapter.subitems); // shows selected chapter in reader if newIsSelected is true
    }

    function toggleSubchapters() {
        setShowSubchapters(!showSubchapters);
    }

    // return chapters with checkboxes and subchapter buttons
    return (<div style={{marginLeft: `${level * 20}px`}}>
            <input type='checkbox' checked={isSelected} onChange={handleSelect}/>
            {chapter.label}
            {chapter.subitems.length > 0 && (
                <button style={{
                    margin: '2px',
                    backgroundColor: 'white',
                    borderStyle: 'solid',
                    borderColor: '#e8e8e8',
                    borderRadius: '2px',
                    borderWidth: '1px'
                }} onClick={toggleSubchapters}>
                    {showSubchapters ? '▼' : '►'}
                </button>)}
            <div style={{display: showSubchapters ? 'block' : 'none'}}>
                {chapter.subitems.map(subchapter => (
                    <Chapter key={subchapter.id} chapter={subchapter} onChapterSelect={onChapterSelect}
                             level={level + 1} parentSelected={isSelected}/>))}
            </div>
        </div>);
}


export default Reader;