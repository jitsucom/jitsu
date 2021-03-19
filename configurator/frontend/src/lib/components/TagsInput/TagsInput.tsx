/* eslint-disable */
import React, { ReactElement, ReactNode } from 'react';
import { Input, Tag, Tooltip } from 'antd';
import PlusOutlined from '@ant-design/icons/lib/icons/PlusOutlined';

type ITagsInputProps = {
  value?: any[];
  onChange?: (val) => void;
  newButtonText?: string;
};

type ITagsInputState = {
  value?: any[];
  inputVisible?: boolean;
  inputValue?: any;
  editInputValue?: any;
  editInputIndex?: any;
};

export default class TagsInput extends React.Component<ITagsInputProps, ITagsInputState> {
  private input: any;
  private editInput: any;

  constructor(props: Readonly<ITagsInputProps>) {
    super(props);
    this.state = {
      value: this.props.value ? this.props.value : [],
      inputVisible: false,
      inputValue: '',
      editInputIndex: -1,
      editInputValue: ''
    };
  }

  handleClose(removedTag) {
    const value = this.state.value.filter((tag) => tag !== removedTag);
    if (this.props.onChange) {
      this.props.onChange(value);
    }
    this.setState({ value });
  }

  showInput() {
    this.setState({ inputVisible: true }, () => this.input.focus());
  }

  handleInputChange(e) {
    this.setState({ inputValue: e.target.value });
  }

  handleInputConfirm() {
    const { inputValue } = this.state;
    let { value } = this.state;
    if (inputValue && value.indexOf(inputValue) === -1) {
      value = [...value, inputValue];
    }
    if (this.props.onChange) {
      this.props.onChange(value);
    }
    this.setState({
      value: value,
      inputVisible: false,
      inputValue: ''
    });
  }

  handleEditInputChange(e) {
    this.setState({ editInputValue: e.target.value });
  }

  handleEditInputConfirm() {
    this.setState(({ value, editInputIndex, editInputValue }) => {
      const newTags = [...value];
      newTags[editInputIndex] = editInputValue;
      if (this.props.onChange) {
        this.props.onChange(newTags);
      }
      return {
        tags: newTags,
        editInputIndex: -1,
        editInputValue: ''
      };
    });
  }

  saveInputRef(input) {
    this.input = input;
  }

  saveEditInputRef(input) {
    this.editInput = input;
  }

  render() {
    const { value, inputVisible, inputValue, editInputIndex, editInputValue } = this.state;
    return (
      <>
        {value.map((tag, index) => {
          if (editInputIndex === index) {
            return (
              <Input
                ref={(e) => this.saveEditInputRef(e)}
                key={tag}
                size="small"
                className="tag-input"
                value={editInputValue}
                onChange={(e) => this.handleEditInputChange(e)}
                onBlur={() => this.handleEditInputConfirm()}
                onPressEnter={() => this.handleEditInputConfirm()}
              />
            );
          }

          const isLongTag = tag.length > 20;

          const tagElem = (
            <Tag className="edit-tag" key={tag} closable={true} onClose={() => this.handleClose(tag)}>
              <span
                onDoubleClick={(e) => {
                  if (index !== 0) {
                    this.setState({ editInputIndex: index, editInputValue: tag }, () => {
                      this.editInput.focus();
                    });
                    e.preventDefault();
                  }
                }}
              >
                {isLongTag ? `${tag.slice(0, 20)}...` : tag}
              </span>
            </Tag>
          );
          return isLongTag ? (
            <Tooltip title={tag} key={tag}>
              {tagElem}
            </Tooltip>
          ) : (
            tagElem
          );
        })}
        {inputVisible && (
          <Input
            ref={(input) => this.saveInputRef(input)}
            type="text"
            size="small"
            className="tag-input"
            value={inputValue}
            onChange={(e) => this.handleInputChange(e)}
            onBlur={() => this.handleInputConfirm()}
            onPressEnter={() => this.handleInputConfirm()}
          />
        )}
        {!inputVisible && (
          <Tag className="site-tag-plus" onClick={() => this.showInput()}>
            <PlusOutlined /> {this.props.newButtonText ? this.props.newButtonText : 'New Tag'}
          </Tag>
        )}
      </>
    );
  }
}
