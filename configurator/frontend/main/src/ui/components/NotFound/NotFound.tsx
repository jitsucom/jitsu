type NotFoundProps = {
  body?: React.ReactNode
  footer?: React.ReactNode
}

export const NotFound: React.FC<NotFoundProps> = ({ body, footer }) => {
  return (
    <section className="flex flex-col justify-center items-center w-full h-full">
      <span className="text-7xl" role="img">
        {"🕵"}
      </span>
      {body && <h3 className="text-4xl">{body}</h3>}
      {footer}
    </section>
  )
}
