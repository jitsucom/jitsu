import { BreadcrumbsProps } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import { NavLink } from 'react-router-dom';
import { routes } from '@page/SourcesPage/routes';

function join<T>(array: T[], separator: T): T[] {
  let res = [];
  for (let i = 0; i < array.length; i++) {
    res.push(array[i]);
    if (i !== array.length - 1) {
      res.push(separator)
    }
  }
  return res;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ elements }) => {
  return <div className="flex flex-row items-center text-base space-x-3">
    {join(elements.map(bc =>
      <div className="">
        {bc.link ?
          <NavLink to={bc.link} className="text-heading">{bc.title}</NavLink> :
          bc.title
        }
      </div>
    ), <div className="text-heading">/</div>)}
  </div>
}