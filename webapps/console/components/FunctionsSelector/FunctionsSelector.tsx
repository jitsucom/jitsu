import React, { useCallback, useState } from "react";
import { DestinationConfig, FunctionConfig, StreamConfig } from "../../lib/schema";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, GripVertical, X } from "lucide-react";
import { FunctionTitle } from "../../pages/[workspaceId]/functions";
import { StreamTitle } from "../../pages/[workspaceId]/streams";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import { WLink } from "../Workspace/WLink";

type SelectedFunction = {
  functionId: string;
  functionOptions?: any;
  enabled?: boolean;
};

export type FunctionsSelectorProps = {
  functions: FunctionConfig[];
  selectedFunctions?: SelectedFunction[];
  onChange: (selectedFunctions: FunctionConfig[]) => void;
  split?: "horizontal" | "vertical";
  stream?: StreamConfig;
  destination?: DestinationConfig;
  disabled?: boolean;
};

const Wrapper: React.FC<React.PropsWithChildren<{ split: "horizontal" | "vertical" }>> = ({ children, split }) => {
  if (split === "vertical") {
    return <div className={"flex-auto max-w-[50%]"}>{children}</div>;
  }
  return <>{children}</>;
};

const FunctionsSelector0: React.FC<FunctionsSelectorProps> = ({
  functions,
  selectedFunctions,
  onChange,
  stream,
  destination,
  disabled,
  split = "horizontal",
}) => {
  const [enabledFunctionsObj, setEnabledFunctionsObj] = useState<{
    enabledFunctions: FunctionConfig[];
    disabledFunctions: FunctionConfig[];
  }>({
    enabledFunctions: (selectedFunctions ?? [])
      .map(s => functions.find(f => s.functionId === "udf." + f.id))
      .filter(f => typeof f !== "undefined") as FunctionConfig[],
    disabledFunctions: functions.filter(f => !(selectedFunctions ?? []).find(e => e.functionId === "udf." + f.id)),
  });
  const { enabledFunctions, disabledFunctions } = enabledFunctionsObj;

  const saveEnabledFunctions = useCallback(
    f => {
      setEnabledFunctionsObj({
        enabledFunctions: f,
        disabledFunctions: functions.filter(func => !f.find((ef: FunctionConfig) => ef.id === func.id)),
      });
      onChange(f);
    },
    [functions, onChange]
  );

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = useCallback(
    event => {
      const { active, over } = event;
      if (active.id !== over.id) {
        const oldIndex = enabledFunctions.findIndex(i => i.id === active.id);
        const newIndex = enabledFunctions.findIndex(i => i.id === over.id);
        if (oldIndex === newIndex) return;
        const reordered = arrayMove(enabledFunctions, oldIndex, newIndex);
        setEnabledFunctionsObj({
          enabledFunctions: reordered,
          disabledFunctions: disabledFunctions,
        });
        onChange(reordered);
      }
    },
    [disabledFunctions, enabledFunctions, onChange]
  );

  return (
    <div className={`w-full flex ${split === "vertical" ? " flex-row items-start gap-4 " : " flex-col items-center"} `}>
      {functions && functions.length > 0 && (
        <Wrapper split={split}>
          {enabledFunctions.length > 0 && (
            <DndContext
              sensors={sensors}
              modifiers={[restrictToVerticalAxis]}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <div className={"w-full flex flex-row px-3 py-1 justify-center text-gray-500  items-center gap-3"}>
                Functions pipeline:
              </div>
              {stream && (
                <>
                  <div className={"flex flex-row px-3 py-0.5 border rounded justify-center  items-center gap-3"}>
                    <StreamTitle stream={stream} size={"small"} />
                  </div>
                  <ArrowDown className={"text-gray-500 w-3 h-3"} />
                </>
              )}
              <SortableContext items={enabledFunctions} strategy={verticalListSortingStrategy}>
                {enabledFunctions.map(func => (
                  <SortableItem
                    disabled={disabled}
                    id={func.id}
                    key={func.id}
                    func={func}
                    onDelete={f => saveEnabledFunctions(enabledFunctions.filter(e => e.id !== f.id))}
                  />
                ))}
              </SortableContext>
              {destination && (
                <>
                  <ArrowDown className={"text-gray-500 w-3 h-3"} />
                  <div className={"flex flex-row px-3 py-0.5 border rounded justify-center  items-center gap-3"}>
                    <DestinationTitle destination={destination} size={"small"} />
                  </div>
                </>
              )}
            </DndContext>
          )}
        </Wrapper>
      )}
      {!disabled && (
        <Wrapper split={split}>
          {split == "horizontal" && <div className={"mt-3"}></div>}
          <div className={"w-full flex flex-row px-3 py-1 justify-center text-gray-500  items-center gap-3"}>
            Choose functions to add to this connection
          </div>
          <div className={"w-full"}>
            {disabledFunctions.length ? (
              disabledFunctions.map(func => (
                <FunctionCard
                  key={func.id}
                  func={func}
                  funcEnabled={false}
                  onAdd={f => saveEnabledFunctions([...enabledFunctions, f])}
                />
              ))
            ) : (
              <div className={"w-full flex flex-row px-3 py-1 justify-center items-center gap-3"}>
                {enabledFunctions.length === 0 ? "No functions added to workspace." : "All functions are added."}{" "}
                <WLink target={"_blank"} href={"/functions"}>
                  Create New Function...
                </WLink>
              </div>
            )}
          </div>
        </Wrapper>
      )}
    </div>
  );
};

const FunctionCard: React.FC<{
  func: FunctionConfig;
  funcEnabled: boolean;
  disabled?: boolean;
  listeners?: any;
  onAdd?: (f: FunctionConfig) => void;
  onDelete?: (f: FunctionConfig) => void;
}> = ({ func, funcEnabled, listeners, onAdd, onDelete, disabled }) => {
  const functionId = "udf." + func.id;

  return (
    <div key={functionId} className={`w-full flex flex-row px-3 border rounded min-h-14 items-center gap-3`}>
      <div className="flex-auto py-3">
        <FunctionTitle f={func} showDescription={true} />
      </div>
      {/*{enabled && <JitsuButton icon={<Braces className={"w-4 h-4"} />} />}*/}
      {!disabled && funcEnabled && (
        <JitsuButton
          type={"text"}
          className={"flex-shrink-0"}
          danger
          onClick={() => (onDelete ? onDelete(func) : undefined)}
          icon={<X className={"w-5 h-5"} />}
        />
      )}
      {!disabled && funcEnabled && <GripVertical {...listeners} className={"flex-shrink-0 text-gray-700 w-5 h-5"} />}
      {!disabled && !funcEnabled && (
        <JitsuButton
          className={"flex-shrink-0"}
          ghost
          type={"primary"}
          onClick={() => (onAdd ? onAdd(func) : undefined)}
        >
          Add
        </JitsuButton>
      )}
    </div>
  );
};

const SortableItem: React.FC<{
  id: string;
  func: FunctionConfig;
  onDelete: (f: FunctionConfig) => void;
  disabled?: boolean;
}> = ({ id, func, onDelete, disabled }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const functionId = "udf." + func.id;

  return (
    <div ref={setNodeRef} style={style} {...attributes} className={"w-full flex flex-col items-center"}>
      <FunctionCard func={func} funcEnabled={true} disabled={disabled} onDelete={onDelete} listeners={listeners} />
    </div>
  );
};

export const FunctionsSelector = React.memo(FunctionsSelector0);
