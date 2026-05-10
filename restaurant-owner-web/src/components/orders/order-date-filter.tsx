import * as React from "react"

import { format } from "date-fns"
import type { DateRange } from "react-day-picker"
import { CalendarDays, RotateCcw } from "lucide-react"

import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type OrderDateFilterPreset =
  | "today"
  | "yesterday"
  | "last7Days"
  | "last30Days"
  | "thisWeek"
  | "thisMonth"
  | "custom"

export type OrderDateFilterValue = {
  preset: OrderDateFilterPreset
  range: DateRange | undefined
}

export const defaultOrderDateFilter: OrderDateFilterValue = {
  preset: "today",
  range: undefined,
}

const presetLabels: Record<OrderDateFilterPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7Days: "Last 7 Days",
  last30Days: "Last 30 Days",
  thisWeek: "This Week",
  thisMonth: "This Month",
  custom: "Custom Range",
}

function getButtonLabel(value: OrderDateFilterValue) {
  if (value.preset !== "custom" || !value.range?.from) {
    return presetLabels[value.preset]
  }

  if (!value.range.to) {
    return format(value.range.from, "dd MMM yyyy")
  }

  return `${format(value.range.from, "dd MMM")} - ${format(
    value.range.to,
    "dd MMM"
  )}`
}

export function OrderDateFilter({
  value,
  onChange,
  onReset,
  resetDisabled = false,
}: {
  value: OrderDateFilterValue
  onChange: (value: OrderDateFilterValue) => void
  onReset?: () => void
  resetDisabled?: boolean
}) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value.preset}
        onValueChange={(nextValue) => {
          const preset = nextValue as OrderDateFilterPreset
          onChange({
            preset,
            range: preset === "custom" ? value.range : undefined,
          })
        }}
      >
        <SelectTrigger className="w-full lg:w-40">
          <SelectValue placeholder="Date range" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="yesterday">Yesterday</SelectItem>
          <SelectItem value="last7Days">Last 7 Days</SelectItem>
          <SelectItem value="last30Days">Last 30 Days</SelectItem>
          <SelectItem value="thisWeek">This Week</SelectItem>
          <SelectItem value="thisMonth">This Month</SelectItem>
          <SelectItem value="custom">Custom Range</SelectItem>
        </SelectContent>
      </Select>

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={value.preset === "custom" ? "default" : "outline"}
            className="justify-start lg:w-[220px]"
          >
            <CalendarDays className="size-4" />
            {getButtonLabel(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={value.range}
            defaultMonth={value.range?.from}
            onSelect={(range) => {
              onChange({ preset: "custom", range })
            }}
          />
        </PopoverContent>
      </Popover>

      {onReset ? (
        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          disabled={resetDisabled}
        >
          <RotateCcw className="size-4" />
          Reset
        </Button>
      ) : null}
    </div>
  )
}
