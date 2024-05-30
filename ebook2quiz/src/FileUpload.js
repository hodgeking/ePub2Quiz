import React, {useRef, useState} from 'react';
import axios from 'axios';
import {useNavigate} from 'react-router-dom';
import './FileUpload.css';
import Modal from 'react-modal';
import LoadingIcons from 'react-loading-icons';


function FileUpload({onUpload}) {
    const fileInput = useRef(null);
    const [checkValidity, setCheckValidity] = useState(false);  // whether to check validity of EPUB file
    const [errorOpen, setErrorOpen] = useState(false);  // whether to open/close error modal
    const [errorMessage, setErrorMessage] = useState('');  // message that appears when there is an error
    const [isLoading, setIsLoading] = useState(false); // to track whether something is loading

    const navigate = useNavigate(); // to navigate to other page

    async function handleSubmit(event) {
        event.preventDefault(); // prevent refresh
        const file = fileInput.current.files[0];

        // create FormData object to send file
        const formData = new FormData();
        formData.append('file', file);
        formData.append('check_validity', checkValidity);

        setIsLoading(true); // show loading modal

        try {
            // make POST request to send file to server (and to later upload it there on Spaces)
            const response = await axios.post('/api/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });

            // call onUpload with file URL from server
            // (currently the url expires after 24h)
            onUpload(response.data.file_url); // sets file URL for the reader to access later

            // navigate to /view
            navigate('/view');
        } catch (error) {
            if (error.response.status === 422) { // if epub file is invalid
                setErrorMessage(error.response.data.message);  // set error message from server
                setErrorOpen(true); // open modal with error message
            } else { // other errors
                console.log(error);
            }
        } finally {
            setIsLoading(false); // hide loading modal
        }
    }

    return (
        <div className='upload'>
            <h1>ePub2Quiz</h1>
            <h4>Upload your EPUB file to generate a multiple-choice quiz on chapters that you select.</h4>
            <ul>
                <li>The file will be shown in a reader that you can navigate with by clicking on buttons or using the
                    arrow keys.
                </li>
                <li>You will be able to select specific chapters to include in the quiz.</li>
                <li>A multiple-choice quiz will be generated with an LLM based on the selected chapters.</li>
                <li>You can take the quiz and check the answers.</li>
            </ul>
            If the system cannot generate any questions, make sure that your EPUB file is valid. <br/>
            You can have the file validated before loading by checking the box below.
            <p></p>
            <form onSubmit={handleSubmit}>
                <input type='file' ref={fileInput} accept='.epub'/> {/* hidden input so i can style it */}
                <button className='button' type='submit'>Upload</button>
                <br/>
            </form>
            <div>
                <br/>
                <input type='checkbox' checked={checkValidity}
                       onChange={e => setCheckValidity(e.target.checked)}/> Validate EPUB (might take more time)
            </div>
            <Modal
                isOpen={errorOpen}
                onRequestClose={() => setErrorOpen(false)}
                style={{
                    overlay: {zIndex: 1001},
                    content: {
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        right: 'auto',
                        bottom: 'auto',
                        marginRight: '-50%',
                        transform: 'translate(-50%, -50%)',
                        width: '300px',
                        height: '100px',
                        textAlign: 'center',
                        overflow: 'auto'
                    }
                }}>
                <p>{errorMessage}</p>  {/* show error message from server */}
                <button onClick={() => setErrorOpen(false)}>Close</button>
            </Modal>
            <Modal
                isOpen={isLoading}
                shouldCloseOnOverlayClick={false}
                shouldCloseOnEsc={false}
                style={{
                    overlay: {zIndex: 1000},
                    content: {
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
                    Loading Reader.. :) <br/> <br/>
                    <LoadingIcons.Oval stroke='#1e80d9'/>
                </div>
            </Modal>
        </div>
    );
}

export default FileUpload
