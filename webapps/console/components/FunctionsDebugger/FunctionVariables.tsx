import React, { useCallback, useEffect } from "react";
import { CirclePlusIcon, EyeIcon, EyeOffIcon, Trash2 } from "lucide-react";
import { Button, Input } from "antd";
import { isEqual } from "juava";

const Var: React.FC<{
  name: string;
  value: string;
  onChange: (name: string, value: string | undefined) => void;
}> = ({ name, value, onChange }) => {
  const [editing, setEditing] = React.useState(false);

  return (
    <div className={"flex gap-2"}>
      <Input
        value={name}
        className={"flex-auto h-10 p-2 basis-1/2 border "}
        onChange={e => {
          onChange(e.target.value, value);
        }}
      />
      {editing ? (
        <Input
          value={value}
          className={"flex-auto h-10 p-2 basis-1/2 border "}
          onChange={e => {
            onChange(name, e.target.value);
          }}
        />
      ) : (
        <div onClick={() => setEditing(true)} className={"flex-auto p-2 basis-1/2 border rounded-md "}>
          {value.replaceAll(/./g, "*")}
        </div>
      )}
      <div className={"w-16 flex-shrink-0 pt-0.5"}>
        <Button
          type={"text"}
          icon={
            editing ? (
              <EyeOffIcon color={"grey"} className={"w-4 h-4"} />
            ) : (
              <EyeIcon color={"grey"} className={"w-4 h-4"} />
            )
          }
          onClick={() => setEditing(!editing)}
        />
        <Button
          type={"text"}
          icon={<Trash2 color={"grey"} className={"w-4 h-4"} />}
          onClick={() => onChange(name, undefined)}
        />
      </div>
    </div>
  );
};

export const FunctionVariables: React.FC<{
  value: Record<string, string>;
  onChange: (r: Record<string, string>) => void;
  className?: string;
}> = ({ value, onChange, className }) => {
  const [array, setArray] = React.useState<[string, string][]>(Object.entries(value));

  const change = useCallback(
    (index: number, name: string, v: string | undefined) => {
      if (typeof v === "undefined") {
        setArray(array.filter((_, i) => i !== index));
      } else {
        const newArr = [...array];
        newArr[index] = [name, v];
        setArray(newArr);
      }
    },
    [array]
  );

  useEffect(() => {
    const newValue = Object.fromEntries(array);
    if (!isEqual(newValue, value)) {
      onChange(newValue);
    }
  }, [array, onChange, value]);

  return (
    <div
      className={`${
        className ?? ""
      } flex-auto px-4 flex flex-col pt-2 gap-2 place-content-start flex-nowrap pb-4 bg-backgroundLight w-full h-full`}
    >
      <div className={"flex gap-2"}>
        <div className={"flex-auto text-textLight basis-1/2 px-0.5 text-xs"}>Name</div>
        <div className={"flex-auto text-textLight basis-1/2 px-0.5 text-xs"}>Value</div>
        <div className={"w-16 flex-shrink-0"}></div>
      </div>
      {array.map(([n, v], index) => {
        return <Var key={index} name={n} value={v} onChange={(nm, vl) => change(index, nm, vl)} />;
      })}
      <div className="flex justify-start">
        <Button
          icon={<CirclePlusIcon className={"w-4 h-4"} />}
          onClick={() => setArray([...array, ["", ""]])}
          type="default"
        >
          Add Variable
        </Button>
      </div>
    </div>
  );
};
