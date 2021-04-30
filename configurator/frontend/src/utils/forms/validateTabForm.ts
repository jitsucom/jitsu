import { Tab } from '@molecule/TabsConfigurator';

interface Options {
  forceUpdate: VoidFunc;
  beforeValidate?: VoidFunc;
  errorCb?: VoidFunc;
}

const validateTabForm = async(tab: Tab, { forceUpdate, beforeValidate, errorCb }: Options) => {
  const form = tab.form;

  try {
    if (beforeValidate) {
      beforeValidate();
    }

    return await form.validateFields();
  } catch (errors) {
    if (errorCb) {
      errorCb(errors);
    }

    forceUpdate();

    throw errors;
  }
}

export { validateTabForm }
