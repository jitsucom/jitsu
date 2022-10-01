import React, { ReactElement, ReactNode, useEffect, useState } from "react"
import { CodeSnippet, LoadableComponent } from "../components"
import ApplicationServices from "../../services/ApplicationServices"
import "./DownloadConfig.less"
import CloudDownloadOutlined from "@ant-design/icons/lib/icons/CloudDownloadOutlined"
import { withPermissionRequirement } from "../../services/permissions"
import { ProjectPermission } from "../../../generated/conf-openapi"

type State = {
  code: string
}

function download(filename, text) {
  let element = document.createElement("a")
  element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text))
  element.setAttribute("download", filename)

  element.style.display = "none"
  document.body.appendChild(element)

  element.click()

  document.body.removeChild(element)
}

class DownloadConfig extends LoadableComponent<{}, State> {
  private readonly services: ApplicationServices = ApplicationServices.get()

  constructor(props: Readonly<{}>, context) {
    super(props, context)
  }

  protected async load(): Promise<State> {
    return {
      code: await this.services.backendApiClient.getRaw(
        `/jitsu/configuration?project_id=${this.services.activeProject.id}`
      ),
    }
  }

  protected renderReady(): React.ReactNode {
    return (
      <>
        <div className="download-config-documentation">
          If you want to host your own instance of{" "}
          <a target="_blank" href="https://github.com/jitsucom/jitsu">
            Jitsu Server
          </a>{" "}
          you can use this configuration file. Note: although it includes all your keys, destinations, sources you
          should add your{" "}
          <a target="_blank" href="https://jitsu.com/docs/configuration">
            meta.storage (Redis) configuration
          </a>{" "}
          by yourself.{" "}
          <a target="_blank" href="https://jitsu.com/docs/deployment">
            Jitsu can be deployed just in a few clicks!
          </a>
        </div>
        <CodeSnippet
          toolbarPosition="top"
          language="yaml"
          size="large"
          extra={
            <a
              onClick={() => {
                download("eventnative.yaml", this.state.code)
              }}
            >
              <u>./eventnative.yaml</u> <CloudDownloadOutlined />
            </a>
          }
        >
          {this.state.code}
        </CodeSnippet>
      </>
    )
  }
}

export default withPermissionRequirement(DownloadConfig, ProjectPermission.MODIFY_CONFIG)

