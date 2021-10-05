import { Tab } from 'ui/components/Tabs/TabsConfigurator';

interface Options {
  forceUpdate: (...args: any) => void;
  beforeValidate?: (...args: any) => void;
  errorCb?: (...args: any) => void;
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

    throw errors;
  } finally {
    forceUpdate();
  }
}

export { validateTabForm }
