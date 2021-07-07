// @Test Utils
import { render, screen } from "tests-utils";
// @Mock Data
import { mockDestinationsList } from "./DestinationsList.test.mock";
// @Component
import { DestinationsList } from "./DestinationsList";

test("displays destinations", async () => {
  // Arrange
  render(
    <DestinationsList
      destinations={mockDestinationsList}
      updateDestinations={() => {}}
      setBreadcrumbs={() => {}}
      sources={[]}
      sourcesError={null}
      updateSources={() => {}}
    />
  );
  // Assert
  mockDestinationsList.forEach(({ _type }) => {
    expect(screen.getByText(`${_type}`)).toBeInTheDocument();
  });
});
