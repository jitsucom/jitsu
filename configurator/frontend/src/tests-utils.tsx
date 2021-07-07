import { FC, ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'

const AllProviders: FC = ({ children }) => {
  return (
    <>
      {children}
    </>
  );
}

const renderWithAllProviders = (
  element: ReactElement,
  options?: Omit<RenderOptions, 'queries'>
) => render(element, { wrapper: AllProviders, ...options })

export * from '@testing-library/react'

export { render as bareRender } from '@testing-library/react';
export { renderWithAllProviders as render };