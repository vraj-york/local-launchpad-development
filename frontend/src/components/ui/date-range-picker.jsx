"use client"

import * as React from "react"
import { endOfDay, format, startOfDay } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

export function DatePickerWithRange({
    className,
    date,
    setDate,
    minDate,
    maxDate,
}) {
    const min = React.useMemo(
        () => (minDate ? startOfDay(minDate) : undefined),
        [minDate],
    )
    const max = React.useMemo(
        () => (maxDate ? endOfDay(maxDate) : undefined),
        [maxDate],
    )

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    id="date"
                    variant={"outline"}
                    className={cn(
                        "justify-start text-left font-normal border-slate-200 bg-transparent",
                        !date && "text-muted-foreground",
                        className
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date?.from ? (
                        date.to ? (
                            <>
                                {format(date.from, "LLL dd, y")} -{" "}
                                {format(date.to, "LLL dd, y")}
                            </>
                        ) : (
                            format(date.from, "LLL dd, y")
                        )
                    ) : (
                        <span>Pick a date</span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={date?.from}
                    selected={date}
                    onSelect={setDate}
                    fromDate={min}
                    toDate={max}
                    disabled={(day) => {
                        if (min && day < min) return true
                        if (max && day > max) return true
                        return false
                    }}
                    numberOfMonths={2}
                />
            </PopoverContent>
        </Popover>
    )

}
