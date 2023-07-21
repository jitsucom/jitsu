import { ApiKey } from "../../lib/schema";
import { useState } from "react";
import { Button, Tooltip } from "antd";
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
  return (
    <div>
      {keys.length === 0 && <div className="flex text-textDisabled justify-center">API keys list us empty</div>}
      {keys.find(key => !!key.plaintext) && (
        <div className="text-textDisabled text-sm">
          Congrats! You're generated a new key(s). Copy it an keep in the safe place. You will not be able to see it
          again once you leave the page
        </div>
      )}
      {keys.map(key => (
        <div key={key.id} className="flex justify-between items-center mb-1  py-1 rounded">
          <div className="">
            {key.plaintext ? (
              <div className="flex items-center">
                <Tooltip
                  className="cursor-pointer"
                  title={
                    <>
                      {" "}
                      <strong>Key generated!</strong> Copy this key and store it in a safe place. You will not be able
                      to see it again.
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
                      {branding.productName} doesn't store full version of a ket. If you haven't recorded the key,
                      generate a new one
                    </>
                  }
                >
                  <code>
                    {key.id}:{key?.hint?.replace("*", "*".repeat(32 - 6))}
                  </code>
                </Tooltip>
              </>
            )}
          </div>
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
        </div>
      ))}
      <div className="flex justify-end">
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
