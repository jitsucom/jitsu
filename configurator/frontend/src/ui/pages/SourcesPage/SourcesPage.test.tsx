// @Test Utils
import { fireEvent, render, screen, waitFor } from 'utils/tests/tests-utils';
// @Mock Server
import { setupMockServer } from 'utils/tests/tests-utils.mock-server';
// @Component
import SourcesPage from './SourcesPage';
import { initializeApplication } from 'App';
import { sourcesPageRoutes } from './SourcesPage.routes';

jest.mock('firebase/app');
jest.mock('antd/lib/message');

const mockServer = setupMockServer();

const mockSourcesList =
  setupMockServer.endpoints.required.sources_get.responseData.sources;

beforeAll(async () => {
  mockServer.listen();
  await initializeApplication();
});
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

const waitForSourcesLoaded = () => screen.findByText('Add source');

const checkSourcesRenderedCorrectly = () => {
  // Each source is rendered
  mockSourcesList.forEach(({ sourceId }) => {
    expect(screen.getByText(`${sourceId}`)).toBeInTheDocument();
  });
  // Each source has edit and delete buttons
  expect(screen.getAllByText('Edit')).toHaveLength(mockSourcesList.length);
  expect(screen.getAllByText('Delete')).toHaveLength(mockSourcesList.length);
};

describe('loads sources, allows user to manipulate them', () => {
  // Arrange
  beforeEach(async () => {
    window.history.replaceState({}, 'Root', sourcesPageRoutes.root);
    render(<SourcesPage setBreadcrumbs={() => {}} />);
    await waitForSourcesLoaded();
  });

  it('loads and renders sources list correctly', async () => {
    checkSourcesRenderedCorrectly();
  });

  it('allows user to open the editor, click through the tabs and save each source', async () => {
    for (const [idx] of mockSourcesList.entries()) {
      const editButtons = screen.getAllByText('Edit');
      // Click "Edit" button
      fireEvent.click(editButtons[idx]);
      // Wait for editor to open
      await waitFor(() => screen.getAllByRole('tab'));
      // Get all tabs, click through them
      const tabs = screen.getAllByRole('tab');
      tabs.forEach(fireEvent.click);
      // Click save button
      fireEvent.click(screen.getByText('Cancel'));
      // Wait for the save operation to complete
      await waitForSourcesLoaded();
      // Check the list is still correctly rendered
      checkSourcesRenderedCorrectly();
    }
  });

  it('allows user to delete each source one by one', async () => {
    const testSourcesList = [...mockSourcesList];
    for (const [idx] of mockSourcesList.entries()) {
      const deleteButtons = screen.getAllByText('Delete');
      // Click "Delete" button
      const elementsCount = deleteButtons.length;
      fireEvent.click(deleteButtons[0]);
      // Wait for the deletion operation to complete
      await waitFor(() => {
        const newElementsCount = screen.getAllByText('Delete').length;
        return newElementsCount === elementsCount - 1;
      });
      // Check the list is still correctly rendered
      testSourcesList.shift();
      testSourcesList.forEach(({ sourceId }) => {
        expect(screen.getByText(`${sourceId}`)).toBeInTheDocument();
      });
    }
  });

  it('allows to add and delete sources of each type', () => {});
});
