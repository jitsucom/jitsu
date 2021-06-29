
type SettingsSection = {
  displayTitle: string;
  route: string;
}

type goToSettingsSection = (sectionKey: string) => void

type Props = {
  config: ReadonlyArray<SettingsSection>;
  handleGoToSection: goToSettingsSection;
}

export const SettingsPageView: React.FC<Props> = ({ children }) => {
  return (
    <>
      {children}
    </>
  );
}