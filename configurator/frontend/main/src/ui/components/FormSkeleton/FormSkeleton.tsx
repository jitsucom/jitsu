import { Col, Row, Skeleton } from "antd"

type Props = {}

export const FormSkeleton: React.FC<Props> = () => {
  return (
    <Row className="w-full h-full">
      <Col span={4} />
      <Col span={20} className={"max-w-3xl"}>
        <Skeleton active paragraph={{ rows: 2 }} />
        <Skeleton active title={false} paragraph={{ rows: 3 }} className={`mt-5`} />
      </Col>
    </Row>
  )
}
