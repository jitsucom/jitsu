import React, { useEffect, useRef } from "react"

/**
 * Accepts a callback that will be fired on click outside of the DOM node stored in the returned `ref`.
 * When used with an `extraRef`, callback will be fired if click was caught outside both nodes stored in `ref` and `extraRef`
 *
 * @example
 * const [popoverContentRef, buttonRef] = useClickOutsideRef<HTMLDivElement, HTMLButtonElement>(
 *  () => setPopoverVisible(false)
 * )
 * return <Popover content={<div ref={popoverContentRef}>...</div>}><Button ref={buttonRef} /></Popover>
 *
 * @param onClickOutside - callback to fire on outside click
 */
export const useClickOutsideRef = <R extends HTMLElement = HTMLElement, E extends HTMLElement = HTMLElement>(
  onClickOutside: () => void | Promise<void>
): [React.MutableRefObject<R>, React.MutableRefObject<E>] => {
  const ref = useRef<R>()
  const extraRef = useRef<E>()
  useEffect(() => {
    const handler = async (event: Event) => {
      if (!ref.current && !extraRef.current) return
      const withExtraRef = !!extraRef.current
      if (!ref.current?.contains || (withExtraRef && !extraRef.current.contains)) return // no support for elements without `contains` method
      if (
        !ref.current.contains(event.target as Element) &&
        withExtraRef &&
        !extraRef.current.contains(event.target as Element)
      )
        await onClickOutside()
    }
    window.addEventListener("click", handler)
    return () => {
      window.removeEventListener("click", handler)
    }
  }, [])
  return [ref, extraRef]
}
