import { UsersList } from '@/components/access/users';
import { TillsPanel } from '@/components/access/tills';
// Tills sit with users: both are who (and what) may act for the company.
export default function Page() { return <div className="space-y-6"><UsersList /><TillsPanel /></div>; }
