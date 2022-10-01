import React, { useState } from "react"
import { LabelEllipsis } from "../LabelEllipsis/LabelEllipsis"

export type EditableNameProps = {
  name: string
  disabled?: boolean
  className?: string
  update: (newName: string) => Promise<any>
  maxLen?: number
  propagateEvent?: boolean
}

export function EditableName({ name, className, update, disabled, maxLen = 25, propagateEvent = false }: EditableNameProps) {
  const changeName = async e => {
    if (!propagateEvent) {
      e.stopPropagation()
      e.preventDefault()
    }
    let newName = prompt("Please, enter a new name", currentName)
    if (newName) {
      try {
        setSaving(true)
        await update(newName)
        setCurrentName(newName)
      } catch (e) {
        //??
      } finally {
        setSaving(false)
      }
    }
  }

  const [saving, setSaving] = useState(false)
  const [currentName, setCurrentName] = useState(name)
  return (
    <span className={`inline-block flex flex-nowrap items-center ${className}`} onDoubleClick={changeName}>
      <span className="">
        <LabelEllipsis maxLen={maxLen}>{!saving ? currentName : "Saving..."}</LabelEllipsis>
      </span>
      {!disabled && <svg
        onClick={changeName}
        style={{ height: "0.8rem", paddingLeft: "0.3rem" }}
        className="cursor-pointer fill-current h-full"
        fill="fillCurrent"
        viewBox="0 0 24 24"
      >
        <path
          fill="fillCurrent"
          d="M 19.171875 2 C 18.448125 2 17.724375 2.275625 17.171875 2.828125 L 16 4 L 20 8 L 21.171875 6.828125 C 22.275875 5.724125 22.275875 3.933125 21.171875 2.828125 C 20.619375 2.275625 19.895625 2 19.171875 2 z M 14.5 5.5 L 3 17 L 3 21 L 7 21 L 18.5 9.5 L 14.5 5.5 z"
        />
      </svg>}
    </span>
  )
}
