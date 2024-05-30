import React, {useState} from 'react'
import {BrowserRouter as Router, Routes, Route} from 'react-router-dom'
import FileUpload from './FileUpload.js'
import Reader from './Reader.js'
import Modal from 'react-modal'
import axios from 'axios'

Modal.setAppElement('#root') // so theres no error in console (needed for accessibility)


function App() {
    const [fileUrl, setFileUrl] = useState(null) // file url of uploaded epub
    const [password, setPassword] = useState('') // password for authentication
    const [authenticated, setAuthenticated] = useState(false) // whether user can access

    // password protected access to page
    const handlePasswordSubmit = async () => {
        try {
            const response = await axios.post('/api/authenticate', {password})
            if (response.data.authenticated) { // if server says password is correct
                setAuthenticated(true)
            } else {
                alert('Incorrect password')
            }
        } catch (error) {
            console.error('Error:', error)
            alert('Incorrect password')
        }
    }

    if (!authenticated) {
        return (
            <div>
                <input type='password' value={password} onChange={e => setPassword(e.target.value)}/>
                <button onClick={handlePasswordSubmit}>Submit</button>
            </div>
        )
    } else {
        // get file URL from FileUpload and set fileUrl, then use it in Reader
        return (
            <Router>
                <Routes>
                    <Route path='/' element={<FileUpload onUpload={setFileUrl}/>}/> {/* will set file url */}
                    <Route path='/view'
                           element={<Reader fileUrl={fileUrl}/>}/> {/* will access file url to display in reader */}
                </Routes>
            </Router>
        )
    }
}

export default App