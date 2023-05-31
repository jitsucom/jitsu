import React, { createContext, PropsWithChildren, ReactNode, useContext, useRef, useState } from "react";
import { ModalStaticFunctions } from "antd/es/modal/confirm";
import { getLog, requireDefined } from "juava";
import { Button, Input, InputRef, Modal } from "antd";
import { useKeyboard } from "./ui";

/**
 * Unless we do this and  just use Modal.show(), custom styles won't be applied
 * to modal content. This is because antd uses a different context for the modal.
 *
 * So it should be used like this:
 *
 * const antdModal = useAntdModal();
 * antdModal.show(...)
 *
 * NOTE: Another way to do it is getAntdModal().show(...). It's a hack
 * that goes against the React way of doing things. Use it only where
 * hooks are not available.
 */
export type AntdModal = Omit<ModalStaticFunctions, "warn">;

const log = getLog("modal");

export type ModalPrompt<T = string> = {
  ask: (question: string, opts?: { okText?: string; suggestedAnswer?: string }) => Promise<T | null>;
};

const PromptModal: React.FC<{
  initialValue?: string;
  placeholder?: string;
  open: boolean;
  question?: ReactNode;
  okText?: ReactNode;
  handleResult: (val: string | null) => void;
}> = ({ open, question, handleResult, initialValue, placeholder, okText }) => {
  const [value, setValue] = useState<string | undefined>(initialValue);
  const inputRef = useRef<InputRef>(null);
  const [displayErrorOnEmpty, setDisplayErrorOnEmpty] = useState(false);
  useKeyboard("Enter", () => {
    if (value) {
      handleResult(value);
    } else {
      setDisplayErrorOnEmpty(true);
    }
  });
  return (
    <Modal
      open={open}
      footer={<></>}
      destroyOnClose={true}
      onCancel={() => handleResult(null)}
      maskStyle={{ backdropFilter: "blur(10px)" }}
    >
      <div>
        <h3 className="font-bold text-lg mb-4">{question || "Dummy question. Would you mind providing an answer?"}</h3>
        <Input
          placeholder={placeholder}
          status={displayErrorOnEmpty && value?.trim() === "" ? "error" : undefined}
          ref={inputRef}
          type="text"
          value={value}
          size="large"
          onChange={e => setValue(e.target.value)}
        />
        <div className="flex justify-end mt-4">
          <Button className="mr-4" onClick={() => handleResult(null)}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={() => {
              if (value === "") {
                setDisplayErrorOnEmpty(true);
                inputRef.current?.focus();
              } else {
                handleResult(value || null);
              }
            }}
          >
            {okText || "Ok"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

type PromptContextProps = {
  question?: ReactNode;
  open: boolean;
  setQuestion: (question: ReactNode) => void;
  setInitialValue: (val?: string) => void;
  setOkText: (okText: ReactNode) => void;
  //focusInput();
  okText?: ReactNode;
  setOpen: (open: boolean) => void;
  responseHandler: ResponseHandler;
  setResponseHandler: (handler: ResponseHandler) => void;
};

export const PromptContext = createContext<PromptContextProps>(undefined!);

const emptyHandler: ResponseHandler = {
  handle: () => {},
};

export type ResponseHandler = {
  handle: (value: string | null) => void;
};

export function PromptContextProvider({ children }) {
  const [question, setQuestion] = useState<ReactNode>(null);
  const [open, setOpen] = useState(false);
  const [responseHandler, setResponseHandler] = useState<ResponseHandler>(() => emptyHandler);
  const [okText, setOkText] = useState<ReactNode>(null);
  const [initialValue, setInitialValue] = useState<string | undefined>();

  log.atDebug().log(`render - <PromptContextProvider />`);

  return (
    <PromptContext.Provider
      value={{
        question,
        okText,
        open,
        setQuestion,
        setOpen,
        responseHandler,
        setResponseHandler,
        setOkText,
        setInitialValue,
      }}
    >
      {children}
      <PromptContext.Consumer>
        {context => {
          log.atDebug().log(`functional child of - <PromptContext.Consumer />. Context:`, context);
          return (
            <PromptModal
              // //random key to destroy the component after it's closed
              // key={Math.random() + "."}
              initialValue={initialValue}
              question={context.question}
              open={context.open}
              okText={context.okText}
              handleResult={res => {
                context.setOpen(false);
                context.setQuestion("never");
                context.responseHandler.handle(res);
              }}
            />
          );
        }}
      </PromptContext.Consumer>
    </PromptContext.Provider>
  );
}

export function useModalPrompt(): ModalPrompt {
  const context = useContext(PromptContext);
  return {
    ask: (question: string, opts = {}) => {
      return new Promise(resolve => {
        context.setOpen(true);
        context.setInitialValue(opts.suggestedAnswer || undefined);
        context.setQuestion(question);
        context.setOkText(opts.okText || "Ok");
        context.setResponseHandler({
          handle: resolve,
        });
      });
    },
  };
}

export const AntdModalProvider: React.FC<PropsWithChildren<{}>> = ({ children }) => {
  const [modal, contextHolder] = Modal.useModal();
  setGlobalAntdModal(modal);
  return (
    <AntdModalContext.Provider value={modal}>
      <>{contextHolder}</>
      <PromptContextProvider>{children}</PromptContextProvider>
    </AntdModalContext.Provider>
  );
};

export let antdModalInstance: AntdModal;

export const setGlobalAntdModal = (instance: AntdModal) => {
  antdModalInstance = instance;
};

export const getAntdModal = (): AntdModal => {
  return requireDefined(antdModalInstance, "there's not global antd modal instance");
};

export const AntdModalContext = createContext<AntdModal>(undefined!);

export function useAntdModal(): AntdModal {
  return requireDefined(
    useContext(AntdModalContext),
    `useAntdModal() should be called inside <AntdModalContext.Provider />`
  );
}
