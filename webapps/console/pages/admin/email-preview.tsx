import { get, useApi } from "../../lib/useApi";
import { useState } from "react";
import { useURLPersistedState } from "../../lib/ui";
import { QueryResponse } from "../../components/QueryResponse/QueryResponse";
import { Select } from "antd";
import { Input } from "antd";
import { AsyncButton } from "../../components/AsyncButton/AsyncButton";
import { branding } from "../../lib/branding";

function RenderTemplate({ params, template }: { params: string; template: string }) {
  const [renderHtml, setRenderedHtml] = useState<string | undefined>("");
  return (
    <div>
      <div className="flex">
        <div className="flex justify-end w-full pt-6">
          <AsyncButton
            onClick={async () => {
              const propsObject = params && params.length > 0 ? JSON.parse(params) : {};
              const { html } = await get(`/api/admin/email-templates/${template}`, {
                method: "POST",
                body: propsObject,
              });
              setRenderedHtml(html);
            }}
            size="large"
            type="primary"
          >
            Render
          </AsyncButton>
        </div>
      </div>
      {renderHtml && (
        <div className="mt-6 bg-backgroundLight px-6 py-6 shadow-lg rounded-lg">
          <div>
            <div className="flex items-center">
              <div className="w-16 text-textDisabled text-sm font-bold">From</div>
              <div className="text-sm font-bold">noreply@{branding.rootDomain}</div>
            </div>
            <div className="flex items-center mb-6">
              <div className="w-16 text-textDisabled text-sm font-bold">To</div>
              <div className="text-sm font-bold">customer@{branding.rootDomain}</div>
            </div>
          </div>
          <div dangerouslySetInnerHTML={{ __html: renderHtml }} />
        </div>
      )}
    </div>
  );
}

const EmailPreviewPage = () => {
  const apiRes = useApi<{ templates: string[] }>("/api/admin/email-templates");
  const [template, setTemplate] = useURLPersistedState<string>("template", {
    defaultVal: "",
    serializer: val => val || "",
    parser: val => val || "",
  });
  const [params, setParams] = useURLPersistedState<string>("props", {
    defaultVal: "{}",
    serializer: val => val || "",
    parser: val => val || "{}",
  });
  return (
    <QueryResponse
      result={apiRes}
      errorTitle="Failed to load templates"
      prepare={({ templates }) => {
        setTemplate(templates[0]);
      }}
      render={({ templates }) => {
        return (
          <div className="border px-6 py-8 w-full max-w-6xl">
            <div>
              <div className="flex items-center space-x-4">
                <div className="py-2 font-bold text-lg">Select template</div>
                <Select value={template} onChange={e => setTemplate(e)}>
                  {templates.map(t => (
                    <Select.Option key={t.key} value={t}>
                      {t}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <div>
                <div className="py-2 font-bold text-lg">Properties</div>
                <Input.TextArea rows={6} value={params} onChange={e => setParams(e.target.value)} />
              </div>
            </div>
            <RenderTemplate template={template} params={params} />
          </div>
        );
      }}
    />
  );
};
export default EmailPreviewPage;
