import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import App from './App.jsx'
import SubjectSchemaEditor from './renderer/schema-editor/SubjectSchemaEditor.jsx'

const isSchemaEditorWindow = window.location.hash === '#/schema-editor'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSchemaEditorWindow ? <SubjectSchemaEditor /> : <App />}
  </StrictMode>,
)
