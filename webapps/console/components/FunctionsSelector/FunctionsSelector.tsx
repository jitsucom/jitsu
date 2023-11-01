import React, { useCallback, useEffect, useState } from "react";
import { DestinationConfig, FunctionConfig, StreamConfig } from "../../lib/schema";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, GripVertical, X } from "lucide-react";
import { FunctionTitle } from "../../pages/[workspaceId]/functions";
import { StreamTitle } from "../../pages/[workspaceId]/streams";
import { DestinationTitle } from "../../pages/[workspaceId]/destinations";
import { JitsuButton } from "../JitsuButton/JitsuButton";

type SelectedFunction = {
  functionId: string;
  functionOptions?: any;
  enabled?: boolean;
};

export type FunctionsSelectorProps = {
  functions: FunctionConfig[];
  selectedFunctions?: SelectedFunction[];
  onChange: (selectedFunctions: FunctionConfig[]) => void;
  stream: StreamConfig;
  destination: DestinationConfig;
};

const FunctionsSelector0: React.FC<FunctionsSelectorProps> = ({
  functions,
  selectedFunctions,
  onChange,
  stream,
  destination,
}) => {
  const [enabledFunctions, setEnabledFunctions] = useState<FunctionConfig[]>(
    (selectedFunctions ?? [])
      .map(s => functions.find(f => s.functionId === "udf." + f.id))
      .filter(f => typeof f !== "undefined") as FunctionConfig[]
  );
  const [disabledFunctions, setDisabledFunctions] = useState<FunctionConfig[]>([]);
  useEffect(() => {
    setDisabledFunctions(functions.filter(f => !enabledFunctions.find(e => e.id === f.id)));
  }, [enabledFunctions, functions, onChange]);

  const saveEnabledFunctions = useCallback(
    f => {
      setEnabledFunctions(f);
      onChange(f);
    },
    [enabledFunctions, onChange]
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const handleDragEnd = useCallback(
    event => {
      const { active, over } = event;
      if (active.id !== over.id) {
        const oldIndex = enabledFunctions.findIndex(i => i.id === active.id);
        const newIndex = enabledFunctions.findIndex(i => i.id === over.id);
        if (oldIndex === newIndex) return;
        const reordered = arrayMove(enabledFunctions, oldIndex, newIndex);
        setEnabledFunctions(reordered);
        onChange(reordered);
      }
    },
    [enabledFunctions, onChange]
  );
  return (
    <div className={"w-full flex flex-col items-center"}>
      {enabledFunctions.length > 0 && (
        <DndContext
          sensors={sensors}
          modifiers={[restrictToVerticalAxis]}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className={"w-full flex flex-row px-3 pb-1 justify-center text-gray-500  items-center gap-3"}>
            Functions pipeline:
          </div>
          <div className={"flex flex-row px-3 py-0.5 border rounded justify-center  items-center gap-3"}>
            <StreamTitle stream={stream} size={"small"} />
          </div>
          <ArrowDown className={"text-gray-500 w-3 h-3"} />
          <SortableContext items={enabledFunctions} strategy={verticalListSortingStrategy}>
            {enabledFunctions.map(func => (
              <SortableItem
                id={func.id}
                key={func.id}
                func={func}
                onDelete={f => saveEnabledFunctions(enabledFunctions.filter(e => e.id !== f.id))}
              />
            ))}
          </SortableContext>
          <ArrowDown className={"text-gray-500 w-3 h-3"} />
          <div className={"flex flex-row px-3 py-0.5 border rounded justify-center  items-center gap-3"}>
            <DestinationTitle destination={destination} size={"small"} />
          </div>
        </DndContext>
      )}
      <div className={"w-full flex flex-row px-3 py-1 mt-4 justify-center text-gray-500  items-center gap-3"}>
        Choose functions to add to this connection
      </div>
      <div className={"w-full"}>
        {disabledFunctions.map(func => (
          <FunctionCard
            key={func.id}
            func={func}
            enabled={false}
            onAdd={f => saveEnabledFunctions([...enabledFunctions, f])}
          />
        ))}
      </div>
    </div>
  );
};

const FunctionCard: React.FC<{
  func: FunctionConfig;
  enabled: boolean;
  listeners?: any;
  onAdd?: (f: FunctionConfig) => void;
  onDelete?: (f: FunctionConfig) => void;
}> = ({ func, enabled, listeners, onAdd, onDelete }) => {
  const functionId = "udf." + func.id;

  return (
    <div key={functionId} className={`w-full flex flex-row px-3 border rounded h-14 items-center gap-3`}>
      <div className="flex-grow">
        <FunctionTitle
          f={func}
          title={() => (
            <>
              <h2>{func.name}</h2>
              <div className="text-xs text-gray-500 font-normal">{func.description}</div>
            </>
          )}
        />
      </div>
      {/*{enabled && <JitsuButton icon={<Braces className={"w-4 h-4"} />} />}*/}
      {enabled && (
        <JitsuButton
          type={"text"}
          danger
          onClick={() => (onDelete ? onDelete(func) : undefined)}
          icon={<X className={"w-5 h-5"} />}
        />
      )}
      {enabled && <GripVertical {...listeners} className={"text-gray-700 w-5 h-5"} />}
      {!enabled && (
        <JitsuButton ghost type={"primary"} onClick={() => (onAdd ? onAdd(func) : undefined)}>
          Add
        </JitsuButton>
      )}
    </div>
  );
};

const SortableItem: React.FC<{ id: string; func: FunctionConfig; onDelete: (f: FunctionConfig) => void }> = ({
  id,
  func,
  onDelete,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const functionId = "udf." + func.id;

  return (
    <div ref={setNodeRef} style={style} {...attributes} className={"w-full flex flex-col items-center"}>
      <FunctionCard func={func} enabled={true} onDelete={onDelete} listeners={listeners} />
    </div>
  );
};

export const FunctionsSelector = React.memo(FunctionsSelector0);
