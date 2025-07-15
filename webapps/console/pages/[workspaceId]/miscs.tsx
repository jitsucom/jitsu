import { WorkspacePageLayout } from "../../components/PageLayout/WorkspacePageLayout";
import { ConfigEditor, ConfigEditorProps } from "../../components/ConfigObjectEditor/ConfigEditor";
import { useWorkspace } from "../../lib/context";
import React from "react";
import { MiscEntity } from "../../lib/schema";
import { FaGear } from "react-icons/fa6";
import { TextareaEditor } from "./destinations";

const Misc: React.FC<any> = () => {
  return (
    <WorkspacePageLayout>
      <MiscList />
    </WorkspacePageLayout>
  );
};

const MiscList: React.FC<{}> = () => {
  const workspace = useWorkspace();

  const config: ConfigEditorProps<MiscEntity> = {
    listColumns: [
      {
        title: "Object Type",
        render: (s: MiscEntity) => <span className={"font-semibold"}>{`${s.objectType}`}</span>,
      },
    ],
    objectType: MiscEntity,
    fields: {
      type: { constant: "misc" },
      workspaceId: { constant: workspace.id },
      cloneId: { hidden: true },
      value: {
        editor: TextareaEditor,
      },
    },
    noun: "Miscellaneous Setting",
    type: "misc",
    explanation: "Miscellaneous settings without enforced format",
    icon: () => <FaGear className="w-full h-full" />,
    editorTitle: (_: MiscEntity, isNew: boolean) => {
      const verb = isNew ? "New" : "Edit";
      return (
        <div className="flex items-center">
          <div className="h-12 w-12 mr-4">
            <FaGear className="w-full h-full" />
          </div>
          {verb} miscellaneous setting
        </div>
      );
    },
  };
  return (
    <>
      <ConfigEditor {...(config as any)} />
    </>
  );
};

export default Misc;
