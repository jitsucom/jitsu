import { BreadcrumbsProps } from '@molecule/Breadcrumbs/Breadcrumbs.types';
import { NavLink } from 'react-router-dom';
import { sourcesPageRoutes } from '@page/SourcesPage/routes';

function join<T>(array: T[], separatorFactory: (id: number) => T): T[] {
  let res = [];
  for (let i = 0; i < array.length; i++) {
    res.push(array[i]);
    if (i !== array.length - 1) {
      res.push(separatorFactory(i))
    }
  }
  return res;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ elements }) => {
  return <div className="flex flex-row items-center text-base space-x-3">
    {join(elements.map((bc, index) =>
      <div className="" key={`element-${index}`}>
        {bc.link ?
          <NavLink to={bc.link} className="text-heading">{bc.title}</NavLink> :
          bc.title
        }
      </div>
    ), (num) => <div key={`sep-${num}`} className="text-heading">/</div>)}
  </div>
}
