import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'

export default function NotFound() {
  return (
    <EmptyState title="Page not found">
      <Link to="/" className="text-accent-700 hover:underline">Back to the Module Explorer</Link>
    </EmptyState>
  )
}
