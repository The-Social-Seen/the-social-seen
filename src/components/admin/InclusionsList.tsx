'use client'

import { Plus, X } from 'lucide-react'

interface Inclusion {
  label: string
  icon: string
}

interface InclusionsListProps {
  items: Inclusion[]
  onChange: (items: Inclusion[]) => void
}

const ICON_OPTIONS = [
  { value: '', label: 'No icon' },
  { value: 'wine', label: 'Wine' },
  { value: 'utensils', label: 'Utensils' },
  { value: 'music', label: 'Music' },
  { value: 'camera', label: 'Camera' },
  { value: 'map-pin', label: 'Location' },
  { value: 'clock', label: 'Clock' },
  { value: 'gift', label: 'Gift' },
  { value: 'star', label: 'Star' },
  { value: 'heart', label: 'Heart' },
  { value: 'coffee', label: 'Coffee' },
  { value: 'ticket', label: 'Ticket' },
]

export default function InclusionsList({ items, onChange }: InclusionsListProps) {
  function addItem() {
    onChange([...items, { label: '', icon: '' }])
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  function updateItem(index: number, field: keyof Inclusion, value: string) {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    )
    onChange(updated)
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-text-primary">
        What&apos;s Included
      </label>
      {items.map((item, i) => (
        // Two-row reflow on mobile: label input on row 1, icon select +
        // remove button on row 2. md+ stays on a single row.
        <div
          key={i}
          className="flex flex-col gap-2 md:flex-row md:items-center"
        >
          <input
            type="text"
            value={item.label}
            onChange={(e) => updateItem(i, 'label', e.target.value)}
            placeholder="e.g. Welcome drink"
            aria-label={`Inclusion ${i + 1} label`}
            className="md:flex-1 w-full px-3 h-11 md:h-9 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
          />
          <div className="flex items-center gap-2">
            <select
              value={item.icon}
              onChange={(e) => updateItem(i, 'icon', e.target.value)}
              aria-label={`Inclusion ${i + 1} icon`}
              className="flex-1 md:flex-none md:w-32 px-2 h-11 md:h-9 rounded-lg border border-border bg-bg-card text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-gold/50"
            >
              {ICON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
              aria-label="Remove inclusion"
            >
              <X className="w-4 h-4 text-red-500" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="inline-flex items-center justify-center gap-1.5 text-sm text-gold hover:text-gold-dark transition-colors font-medium border border-gold/40 hover:bg-gold/5 rounded-full px-4 py-2 min-h-[44px] w-full md:w-auto md:border-0 md:px-0 md:py-0 md:min-h-0 md:hover:bg-transparent"
      >
        <Plus className="w-4 h-4" />
        Add item
      </button>
    </div>
  )
}
