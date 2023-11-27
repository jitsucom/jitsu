// @Components
import { Collapse, Drawer } from "antd"
// @Types
import { SourceConnector } from "@jitsu/catalog"
// @Styles
import styles from "./SourceEditorDocumentationDrawer.module.less"

type Props = {
  sourceDataFromCatalog: SourceConnector
  visible: boolean
  setVisible: (value: boolean) => void
}

export const SourceEditorDocumentationDrawer: React.FC<Props> = ({ sourceDataFromCatalog, visible, setVisible }) => {
  return (
    <Drawer
      title={<h2>{sourceDataFromCatalog.displayName} documentation</h2>}
      placement="right"
      closable={true}
      onClose={() => setVisible(false)}
      width="70%"
      visible={visible}
    >
      <div className={styles.documentation}>
        <Collapse defaultActiveKey={["overview", "connection"]} ghost>
          <Collapse.Panel
            header={<div className="uppercase font-bold">{sourceDataFromCatalog.displayName} overview</div>}
            key="overview"
          >
            {sourceDataFromCatalog.documentation.overview}
          </Collapse.Panel>
          <Collapse.Panel header={<div className="uppercase font-bold">How to connect</div>} key="connection">
            {sourceDataFromCatalog.documentation.connection}
          </Collapse.Panel>
        </Collapse>
      </div>
    </Drawer>
  )
}
