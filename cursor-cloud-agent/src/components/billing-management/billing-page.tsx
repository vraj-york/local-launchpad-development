import React from 'react';

/**
 * BillingManagement Component
 * 
 * Target Design: https://www.figma.com/design/PS90cVnLY2qWdwRhTtWQAl/Untitled?node-id=591-1527049
 * 
 * This component represents the system-wide billing management interface.
 * Note: Due to tool call limits, the table data and some sub-components 
 * are implemented as skeletons based on initial design metadata.
 */

const BillingManagement: React.FC = () => {
  return (
    <div className="flex h-screen bg-[#f8f7fb] overflow-hidden">
      {/* Sidebar Placeholder (280px wide in design) */}
      <aside className="w-[280px] bg-white border-r border-[#ddd9eb] hidden lg:flex flex-col">
        <div className="p-6 font-semibold text-[#2f414a]">Super Admin</div>
        <nav className="flex-1 px-4 space-y-1">
          <div className="p-3 rounded-lg bg-[#305fa1] text-white">Billing Management</div>
          {/* Other nav items */}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Placeholder (60px high) */}
        <header className="h-[60px] bg-white border-b border-[#ddd9eb] flex items-center px-6 shrink-0">
          <div className="flex-1" />
          <div className="w-8 h-8 rounded-full bg-gray-200" />
        </header>

        <main className="flex-1 overflow-auto p-6 lg:p-10">
          {/* Content + Btns */}
          <div className="flex flex-col lg:flex-row lg:items-end justify-between mb-8">
            <div className="flex-1">
              <h1 className="text-[20px] font-semibold text-[#2f414a] leading-[24px] mb-1">
                Billing Management
              </h1>
              <p className="text-[14px] text-[#385966] leading-[21px]">
                Manage all the system-wide billing related things in one place.
              </p>
            </div>
            {/* Buttons hidden in initial view but defined in design */}
          </div>

          {/* Card Wrapper */}
          <div className="bg-white border border-[#ddd9eb] rounded-xl shadow-sm overflow-hidden flex flex-col h-[727px]">
            {/* Table Header / Filters */}
            <div className="p-4 border-b border-[#ddd9eb] flex items-center gap-4">
              <div className="relative w-80">
                <input 
                  type="text" 
                  placeholder="Search..." 
                  className="w-full h-9 px-3 rounded-lg border border-[#ddd9eb] text-sm focus:outline-none focus:ring-1 focus:ring-[#305fa1]"
                />
              </div>
              <div className="flex-1 flex gap-2">
                <select className="h-9 px-3 rounded-lg border border-[#ddd9eb] text-sm bg-transparent">
                  <option>All Status</option>
                </select>
                <select className="h-9 px-3 rounded-lg border border-[#ddd9eb] text-sm bg-transparent">
                  <option>All Plans</option>
                </select>
              </div>
              <button className="h-9 px-4 bg-[#305fa1] text-white rounded-lg text-sm font-medium">
                Export
              </button>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-[#fcfcfd] sticky top-0 z-10 border-b border-[#ddd9eb]">
                  <tr>
                    <th className="p-4 w-[60px]"><input type="checkbox" className="rounded" /></th>
                    <th className="p-4 font-medium text-[#498291]">Invoice ID</th>
                    <th className="p-4 font-medium text-[#498291]">Company</th>
                    <th className="p-4 font-medium text-[#498291]">Status</th>
                    <th className="p-4 font-medium text-[#498291]">Amount</th>
                    <th className="p-4 font-medium text-[#498291]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ddd9eb]">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4"><input type="checkbox" className="rounded" /></td>
                      <td className="p-4 text-[#2f414a] font-medium">INV-2024-00{i}</td>
                      <td className="p-4 text-[#385966]">Acme Corp {i}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          i % 3 === 0 ? 'bg-green-50 text-green-700' : 
                          i % 3 === 1 ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
                        }`}>
                          {i % 3 === 0 ? 'Paid' : i % 3 === 1 ? 'Pending' : 'Overdue'}
                        </span>
                      </td>
                      <td className="p-4 text-[#2f414a] font-medium">$ {(1240.50 * i).toFixed(2)}</td>
                      <td className="p-4">
                        <button className="text-[#305fa1] hover:underline font-medium">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-[#ddd9eb] flex items-center justify-between bg-[#fcfcfd]">
              <span className="text-xs text-[#498291]">Showing 8 of 80 results</span>
              <div className="flex gap-1">
                <button className="px-3 py-1 border border-[#ddd9eb] rounded text-xs hover:bg-gray-50">Prev</button>
                {[1, 2, 3].map(n => (
                  <button key={n} className={`px-3 py-1 border border-[#ddd9eb] rounded text-xs ${n === 1 ? 'bg-[#305fa1] text-white border-[#305fa1]' : 'hover:bg-gray-50'}`}>
                    {n}
                  </button>
                ))}
                <button className="px-3 py-1 border border-[#ddd9eb] rounded text-xs hover:bg-gray-50">Next</button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default BillingManagement;
