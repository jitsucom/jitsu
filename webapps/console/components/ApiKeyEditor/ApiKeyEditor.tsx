import { ApiKey } from "../../lib/schema";
import { useState } from "react";
import { Button, Table, Tooltip } from "antd";
import { branding } from "../../lib/branding";
import { confirmOp, copyTextToClipboard } from "../../lib/ui";
import { FaCopy, FaPlus, FaTrash } from "react-icons/fa";
import { randomId } from "juava";
import { CustomWidgetProps } from "../ConfigObjectEditor/Editors";

const CopyToClipboard: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  return (
    <Tooltip title={!copied ? "Copy to clipboard" : "Copied!"}>
      <Button
        type="text"
        onClick={() => {
          setCopied(true);
          copyTextToClipboard(text);
        }}
      >
        <FaCopy />
      </Button>
    </Tooltip>
  );
};

function hint(key: string) {
  return key.substring(0, 3) + "*" + key.substring(key.length - 3);
}

export const ApiKeysEditor: React.FC<CustomWidgetProps<ApiKey[]>> = props => {
  const [keys, setKeys] = useState<ApiKey[]>(props.value || []);
  const columns = [
    {
      title: "Key",
      key: "id",
      width: "90%",
      render: (key: ApiKey) => {
        return key.plaintext ? (
          <div className="flex items-center">
            <Tooltip
              className="cursor-pointer"
              title={
                <>
                  {" "}
                  <strong>Key generated!</strong> Copy this key and store it in a safe place. You will not be able to
                  see it again.
                </>
              }
            >
              <code>
                {key.id}:{key.plaintext}
              </code>
            </Tooltip>
            <CopyToClipboard text={`${key.id}:${key.plaintext}`} />
          </div>
        ) : (
          <>
            <Tooltip
              className="cursor-pointer"
              title={
                <>
                  {branding.productName} doesn't store full version of a ket. If you haven't recorded the key, generate
                  a new one
                </>
              }
            >
              <code>
                {key.id}:{key?.hint?.replace("*", "*".repeat(32 - 6))}
              </code>
            </Tooltip>
          </>
        );
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Created</div>,
      className: "text-right text-xs text-text whitespace-nowrap",
      dataIndex: "createdAt",
      render: createdAt => {
        return <div className="flex items-center">{createdAt ? new Date(createdAt).toLocaleString() : ""}</div>;
      },
    },
    {
      title: <div className={"whitespace-nowrap"}>Last Used</div>,
      className: "text-right text-xs text-text whitespace-nowrap",
      dataIndex: "lastUsed",
      render: lastUsed => {
        return lastUsed ? new Date(lastUsed).toLocaleString() : "Never";
      },
    },
    {
      title: "",
      className: "text-right",
      key: "actions",
      render: (key: ApiKey) => {
        return (
          <div>
            <Button
              type="text"
              onClick={async () => {
                if (
                  key.plaintext ||
                  (await confirmOp("Are you sure you want to delete this API key? You won't be able to recover it"))
                ) {
                  const newVal = keys.filter(k => k.id !== key.id);
                  setKeys(newVal);
                  props.onChange(newVal);
                }
              }}
            >
              <FaTrash />
            </Button>
          </div>
        );
      },
    },
  ];
  return (
    <div className={"pt-3"}>
      {keys.length === 0 && <div className="flex text-textDisabled justify-center">API keys list us empty</div>}
      <Table size={"small"} columns={columns} dataSource={keys} pagination={false} rowKey={k => k.id} />
      <div className="flex justify-between p-2">
        {keys.find(key => !!key.plaintext) ? (
          <div className="text-text text-sm">
            Congrats! You're generated a new key(s). Copy it an keep in the safe place.
            <br />
            You will not be able to see it again once you leave the page
          </div>
        ) : (
          <div></div>
        )}
        <Button
          type="text"
          onClick={() => {
            const newKey = randomId(32);
            const newVal = [...keys, { id: randomId(32), plaintext: newKey, hint: hint(newKey) }];
            setKeys(newVal);
            props.onChange(newVal);
          }}
        >
          <FaPlus />
        </Button>
      </div>
    </div>
  );
};
