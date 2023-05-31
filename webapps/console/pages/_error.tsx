const Page500 = props => {
  return <pre>{JSON.stringify(props, null, 2)}</pre>;
};

Page500.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Page500;
