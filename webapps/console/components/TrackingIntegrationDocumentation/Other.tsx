export const Other: React.FC<{ domain: string }> = ({ domain }) => {
  return (
    <div className="py-8 px-6 flex">
      <div className="prose max-w-6xl w-full ">
        <ul>
          <li>
            <a href={"https://docs.jitsu.com/sending-data/react-native"} target={"_blank"} rel={"noreferrer noopener"}>
              React Native
            </a>
          </li>
          <li>
            <a href={"https://docs.jitsu.com/sending-data/ios"} target={"_blank"} rel={"noreferrer noopener"}>
              iOS
            </a>
          </li>
          <li>
            <a href={"https://docs.jitsu.com/sending-data/android"} target={"_blank"} rel={"noreferrer noopener"}>
              Android
            </a>
          </li>
          <li>
            <a href={"https://docs.jitsu.com/sending-data/segment-proxy"} target={"_blank"} rel={"noreferrer noopener"}>
              Segment Proxy
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
};
