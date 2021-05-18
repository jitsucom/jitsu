import { ReactNode } from 'react';

export type BreadcrumbsProps = {
  elements: BreadcrumbElement[]
}

export type BreadcrumbElement = {
  link?: string
  title: ReactNode
}

export function withHome(props: BreadcrumbsProps): BreadcrumbsProps {
  return {
    elements: [
      { link: '/', title: 'Home' },
      ...props.elements
    ]
  };
}