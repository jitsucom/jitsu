// @Test Utils
import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within
} from 'utils/tests/tests-utils';
// @Mock Server
import { setupMockServer } from 'utils/tests/tests-utils.mock-server';
// @Component
import DestinationsPage from './DestinationsPage';
import { initializeApplication } from 'App';
import { destinationPageRoutes } from './DestinationsPage.routes';

jest.mock('firebase/app');
jest.mock('antd/lib/message');

const mockServer = setupMockServer();

const mockDestinationsList =
  setupMockServer.endpoints.required.destinations_get.responseData.destinations;

beforeAll(async () => {
  mockServer.listen();
  await initializeApplication();
});
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

const waitForDestinationsLoaded = () => screen.findByText('Add destination');

const checkDestinationsRenderedCorrectly = () => {
  // Each destination is rendered
  mockDestinationsList.forEach(({ _id }) => {
    expect(screen.getByText(`${_id}`)).toBeInTheDocument();
  });
  // Each destination has edit and delete buttons
  expect(screen.getAllByText('Edit')).toHaveLength(mockDestinationsList.length);
  expect(screen.getAllByText('Delete')).toHaveLength(
    mockDestinationsList.length
  );
};

describe('loads destinations, allows user to manipulate them', () => {
  // Arrange
  beforeEach(async () => {
    window.history.replaceState({}, 'Root', destinationPageRoutes.root);
    render(<DestinationsPage setBreadcrumbs={() => {}} />);
    await waitForDestinationsLoaded();
  });

  it('loads and renders destinations list correctly', async () => {
    checkDestinationsRenderedCorrectly();
  });

  it('allows user to open the editor, click through the tabs and save each destination', async () => {
    for (const [idx] of mockDestinationsList.entries()) {
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
      await waitForDestinationsLoaded();
      // Check the list is still correctly rendered
      checkDestinationsRenderedCorrectly();
    }
  });

  it('allows user to delete each destination one by one', async () => {
    const testDetinationsList = [...mockDestinationsList];
    for (const [idx] of mockDestinationsList.entries()) {
      const deleteButtons = screen.getAllByText('Delete');
      // Click "Delete" button
      fireEvent.click(deleteButtons[0]);
      // Wait for the confirmation dialog
      const confirmationDialog = await screen.findByRole('dialog');
      // Confirm deletion
      fireEvent.click(within(confirmationDialog).getByText('Delete'));
      // Wait for the deletion operation to complete
      await waitForElementToBeRemoved(() => screen.getByRole('dialog'));
      // Check the list is still correctly rendered
      testDetinationsList.shift();
      testDetinationsList.forEach(({ _id }) => {
        expect(screen.getByText(`${_id}`)).toBeInTheDocument();
      });
    }
  });

  it('allows to add and delete destinations of each type', () => {});
});
