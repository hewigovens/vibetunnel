import { TIMEOUTS } from '../constants/timeouts';
import { screenshotOnError } from '../helpers/screenshot.helper';
import { validateCommand, validateSessionName } from '../utils/validation.utils';
import { BasePage } from './base.page';

export class SessionListPage extends BasePage {
  // Selectors
  private readonly selectors = {
    createButton: '[data-testid="create-session-button"]',
    createButtonFallback: 'button[title="Create New Session"]',
    createButtonFallbackWithShortcut: 'button[title="Create New Session (⌘K)"]',
    sessionNameInput: '[data-testid="session-name-input"]',
    commandInput: '[data-testid="command-input"]',
    workingDirInput: '[data-testid="working-dir-input"]',
    submitButton: '[data-testid="create-session-submit"]',
    sessionCard: 'session-card',
    modal: 'text="New Session"',
    noSessionsMessage: 'text="No active sessions"',
  };
  async navigate() {
    await super.navigate('/');
    await this.waitForLoadComplete();

    // Ensure we can interact with the page
    await this.dismissErrors();

    // Wait for create button to be clickable
    const createBtn = this.page
      .locator(this.selectors.createButton)
      .or(this.page.locator(this.selectors.createButtonFallback))
      .or(this.page.locator(this.selectors.createButtonFallbackWithShortcut))
      .first();
    await createBtn.waitFor({ state: 'visible', timeout: 5000 });
  }

  async createNewSession(sessionName?: string, spawnWindow = false, command?: string) {
    // IMPORTANT: Set the spawn window preference in localStorage BEFORE opening the modal
    // This ensures the form loads with the correct state
    await this.page.evaluate((shouldSpawnWindow) => {
      // Clear all form-related localStorage values first to ensure clean state
      localStorage.removeItem('vibetunnel_spawn_window');
      localStorage.removeItem('vibetunnel_last_command');
      localStorage.removeItem('vibetunnel_last_working_dir');
      localStorage.removeItem('vibetunnel_title_mode');

      // Then set the spawn window value we want
      localStorage.setItem('vibetunnel_spawn_window', String(shouldSpawnWindow));
    }, spawnWindow);

    // Dismiss any error messages
    await this.dismissErrors();

    // Add a small delay to ensure localStorage changes are processed
    await this.page.waitForTimeout(100);

    // Click the create session button
    // Try to find the create button in different possible locations
    const createButton = this.page
      .locator(this.selectors.createButton)
      .or(this.page.locator(this.selectors.createButtonFallback))
      .or(this.page.locator(this.selectors.createButtonFallbackWithShortcut))
      .first(); // Use first() in case there are multiple buttons

    try {
      // Wait for button to be visible and stable before clicking
      await createButton.waitFor({ state: 'visible', timeout: 5000 });

      // Scroll button into view if needed
      await createButton.scrollIntoViewIfNeeded();

      // Try regular click first
      try {
        await createButton.click({ timeout: 5000 });
      } catch (_clickError) {
        await createButton.click({ force: true, timeout: 5000 });
      }

      // Wait for modal to exist first
      await this.page.waitForSelector('session-create-form', {
        state: 'attached',
        timeout: 10000,
      });

      // Wait for the session name input to be visible - this is what we actually need
      // This approach is more reliable than waiting for the modal wrapper
      await this.page.waitForSelector('[data-testid="session-name-input"]', {
        state: 'visible',
        timeout: 15000,
      });

      // Additional wait to ensure modal is fully interactive
      await this.page.waitForTimeout(200);
    } catch (error) {
      console.error('Failed to click create button:', error);
      await screenshotOnError(
        this.page,
        new Error('Failed to click create button'),
        'create-button-click-failed'
      );
      throw error;
    }

    // Modal text might not be visible due to view transitions, skip this check

    // Wait for modal to be fully interactive
    await this.page.waitForFunction(
      () => {
        const modalForm = document.querySelector('session-create-form');
        if (!modalForm) return false;

        const input = document.querySelector(
          '[data-testid="session-name-input"], input[placeholder="My Session"]'
        ) as HTMLInputElement;
        // Check that input exists, is visible, and is not disabled
        return input && !input.disabled && input.offsetParent !== null;
      },
      { timeout: TIMEOUTS.UI_UPDATE }
    );

    // Now wait for the session name input to be visible AND stable
    let inputSelector: string;
    try {
      await this.page.waitForSelector('[data-testid="session-name-input"]', {
        state: 'visible',
        timeout: 5000,
      });
      inputSelector = '[data-testid="session-name-input"]';
    } catch {
      // Fallback to placeholder if data-testid is not found
      await this.page.waitForSelector('input[placeholder="My Session"]', {
        state: 'visible',
        timeout: 5000,
      });
      inputSelector = 'input[placeholder="My Session"]';
    }

    // Extra wait to ensure the input is ready for interaction
    await this.page.waitForFunction(
      (selector) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        return input && !input.disabled && input.offsetParent !== null;
      },
      inputSelector,
      { timeout: 2000 }
    );

    // Verify spawn window toggle is in correct state (should be set from localStorage)
    const spawnWindowToggle = this.page
      .locator('[data-testid="spawn-window-toggle"]')
      .or(this.page.locator('button[role="switch"]'));

    // Wait for the toggle to be ready
    await spawnWindowToggle.waitFor({ state: 'visible', timeout: 2000 });

    // Verify the state matches what we expect
    const isSpawnWindowOn = (await spawnWindowToggle.getAttribute('aria-checked')) === 'true';

    // If the state doesn't match, there's an issue with localStorage loading
    if (isSpawnWindowOn !== spawnWindow) {
      console.warn(
        `WARNING: Spawn window toggle state mismatch! Expected ${spawnWindow} but got ${isSpawnWindowOn}`
      );
      // Try clicking to correct it
      await spawnWindowToggle.click({ force: true });
      await this.page.waitForTimeout(500);
    }

    // Fill in the session name if provided
    if (sessionName) {
      // Validate session name for security
      validateSessionName(sessionName);

      // Use the selector we found earlier - use force: true to bypass visibility checks
      try {
        await this.page.fill(inputSelector, sessionName, { timeout: 3000, force: true });
      } catch (e) {
        const error = new Error(`Could not fill session name field: ${e}`);
        await screenshotOnError(this.page, error, 'fill-session-name-error');

        // Check if the page is still valid
        try {
          const url = await this.page.url();
          console.log('Current URL:', url);
          const title = await this.page.title();
          console.log('Page title:', title);
        } catch (pageError) {
          console.error('Page appears to be closed:', pageError);
        }

        throw error;
      }
    }

    // Fill in the command if provided
    if (command) {
      // Validate command for security
      validateCommand(command);

      try {
        await this.page.fill('[data-testid="command-input"]', command, { force: true });
      } catch {
        // Check if page is still valid before trying fallback
        if (this.page.isClosed()) {
          throw new Error('Page was closed unexpectedly');
        }
        // Fallback to placeholder selector
        try {
          await this.page.fill('input[placeholder="zsh"]', command, { force: true });
        } catch (fallbackError) {
          console.error('Failed to fill command input:', fallbackError);
          throw fallbackError;
        }
      }
    }

    // Ensure form is ready for submission
    await this.page.waitForFunction(
      () => {
        // Find the Create button using standard DOM methods
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitButton = buttons.find((btn) => btn.textContent?.includes('Create'));
        // The form is ready if the Create button exists and is not disabled
        // Name is optional, so we don't check for it
        return submitButton && !submitButton.hasAttribute('disabled');
      },
      { timeout: 2000 }
    );

    // Submit the form - click the Create button
    const submitButton = this.page
      .locator('[data-testid="create-session-submit"]')
      .or(this.page.locator('button:has-text("Create")'));

    // Make sure button is not disabled
    await submitButton.waitFor({ state: 'visible', timeout: 5000 });
    const isDisabled = await submitButton.isDisabled();
    if (isDisabled) {
      throw new Error('Create button is disabled - form may not be valid');
    }

    // Click and wait for response

    // Also log any console errors from the page
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('Browser console error:', msg.text());
      }
    });

    const responsePromise = this.page.waitForResponse(
      (response) => {
        const isSessionEndpoint = response.url().includes('/api/sessions');
        const isPost = response.request().method() === 'POST';
        return isSessionEndpoint && isPost;
      },
      { timeout: 20000 } // Increased timeout for CI
    );

    // Click the submit button
    await submitButton.click({ timeout: 5000 });

    // Wait for navigation to session view (only for web sessions)
    if (!spawnWindow) {
      let sessionId: string | undefined;

      try {
        const response = await Promise.race([
          responsePromise,
          this.page
            .waitForTimeout(19000)
            .then(() => null), // Slightly less than response timeout
        ]);

        if (response) {
          if (response.status() !== 201 && response.status() !== 200) {
            const body = await response.text();
            console.error(`Session creation failed with status ${response.status()}: ${body}`);
            throw new Error(`Session creation failed with status ${response.status()}: ${body}`);
          }

          // Get session ID from response
          const responseBody = await response.json();
          sessionId = responseBody.sessionId;

          // Log if session ID is missing
          if (!sessionId) {
            console.error('Session created but no sessionId in response:', responseBody);
          }
        } else {
          // Check if a session was actually created by looking for it in the DOM
          const _createdSession = await this.page.evaluate((name) => {
            const cards = document.querySelectorAll('session-card');
            for (const card of cards) {
              if (card.textContent?.includes(name)) {
                return true;
              }
            }
            return false;
          }, sessionName);
        }
      } catch (error) {
        console.error('Error waiting for session response:', error);
        // Don't throw yet, check if we navigated anyway
      }

      // Give the app time to process the session and navigate
      await this.page.waitForTimeout(2000);

      // Wait for modal to close - check if the form's visible property is false
      await this.page
        .waitForFunction(
          () => {
            const form = document.querySelector('session-create-form');
            // Modal is closed if form doesn't exist or visible is false
            return (
              !form || !form.hasAttribute('visible') || form.getAttribute('visible') === 'false'
            );
          },
          { timeout: 10000 }
        )
        .catch(async (error) => {
          // Log current state for debugging
          const modalState = await this.page.evaluate(() => {
            const form = document.querySelector('session-create-form');
            return {
              exists: !!form,
              visible: form?.getAttribute('visible'),
              dataModalState: form?.getAttribute('data-modal-state'),
              hasVisibleAttribute: form?.hasAttribute('visible'),
            };
          });
          console.error('Modal did not close. Current state:', modalState);
          throw error;
        });

      // Check if we're already on the session page
      const currentUrl = this.page.url();
      if (currentUrl.includes('?session=')) {
      } else {
        // If we have a session ID, try navigating manually
        if (sessionId) {
          await this.page.goto(`/?session=${sessionId}`, { waitUntil: 'domcontentloaded' });
        } else {
          // Wait for automatic navigation
          try {
            await this.page.waitForURL(/\?session=/, { timeout: 10000 });
          } catch (error) {
            const finalUrl = this.page.url();
            console.error(`Failed to navigate to session. Current URL: ${finalUrl}`);
            // Take a screenshot
            await screenshotOnError(
              this.page,
              new Error(`Navigation timeout. URL: ${finalUrl}`),
              'session-navigation-timeout'
            );
            throw error;
          }
        }
      }

      // Wait for terminal to be ready
      await this.page.waitForSelector('vibe-terminal', { state: 'visible', timeout: 10000 });
    } else {
      // For spawn window, wait for modal to close
      await this.page.waitForSelector('.modal-content', { state: 'hidden', timeout: 4000 });
    }
  }

  async getSessionCards() {
    // Use the element name instead of data-testid
    const cards = await this.page.locator('session-card').all();
    return cards;
  }

  async clickSession(sessionName: string) {
    // First ensure we're on the session list page
    if (this.page.url().includes('?session=')) {
      await this.page.goto('/', { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle');
    }

    // Wait for session cards to load
    await this.page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('session-card');
        const noSessionsMsg = document.querySelector('.text-dark-text-muted');
        return cards.length > 0 || noSessionsMsg?.textContent?.includes('No terminal sessions');
      },
      { timeout: 10000 }
    );

    // Check if we have any session cards
    const cardCount = await this.getSessionCount();
    if (cardCount === 0) {
      throw new Error('No session cards found on the page');
    }

    // Look for the specific session card
    const sessionCard = (await this.getSessionCard(sessionName)).first();

    // Wait for the specific session card to be visible
    await sessionCard.waitFor({ state: 'visible', timeout: 10000 });

    // Scroll into view if needed
    await sessionCard.scrollIntoViewIfNeeded();

    // Click on the session card
    await sessionCard.click();

    // Wait for navigation to session view
    await this.page.waitForURL(/\?session=/, { timeout: 5000 });
  }

  async isSessionActive(sessionName: string): Promise<boolean> {
    const sessionCard = await this.getSessionCard(sessionName);
    // Look for the status text in the footer area
    const statusText = await sessionCard.locator('span:has(.w-2.h-2.rounded-full)').textContent();
    // Sessions show "RUNNING" when active, not "active"
    return statusText?.toLowerCase() === 'running' || false;
  }

  async killSession(sessionName: string) {
    // Ensure no modal is blocking interaction
    await this.closeAnyOpenModal();

    // First check if the session card exists
    const sessionCardCount = await this.page
      .locator(`session-card:has-text("${sessionName}")`)
      .count();
    if (sessionCardCount === 0) {
      // Session already removed, nothing to do
      return;
    }

    const sessionCard = await this.getSessionCard(sessionName);

    // Wait for the session card to be visible
    try {
      await sessionCard.waitFor({ state: 'visible', timeout: 4000 });
    } catch {
      // Session might have been removed already
      return;
    }

    // The kill button should have data-testid="kill-session-button"
    const killButton = sessionCard.locator('[data-testid="kill-session-button"]');

    // Check if button exists before trying to interact
    const buttonCount = await killButton.count();
    if (buttonCount === 0) {
      // Button not found, session might already be killed
      return;
    }

    // Wait for the button to be visible and enabled
    await killButton.waitFor({ state: 'visible', timeout: 4000 });

    // Only scroll if element is still attached
    try {
      await killButton.scrollIntoViewIfNeeded();
    } catch {
      // Element might have been removed, check again
      if ((await killButton.count()) === 0) {
        return;
      }
    }

    // Set up dialog handler BEFORE clicking to avoid race condition
    // But use Promise.race to handle cases where no dialog appears
    const dialogPromise = this.page.waitForEvent('dialog', { timeout: 2000 });

    // Click the button (this might or might not trigger a dialog)
    const clickPromise = killButton.click();

    // Wait for either dialog or click to complete
    try {
      // Try to handle dialog if it appears
      const dialog = await Promise.race([
        dialogPromise,
        // Also wait a bit to see if dialog will appear
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]);

      if (dialog) {
        await dialog.accept();
      }
    } catch {
      // No dialog appeared, which is fine
    }

    // Wait for the click action to complete
    await clickPromise;
  }

  async waitForEmptyState() {
    await this.page.waitForSelector(this.selectors.noSessionsMessage, { timeout: 4000 });
  }

  async getSessionCount(): Promise<number> {
    const cards = this.page.locator(this.selectors.sessionCard);
    return cards.count();
  }

  async waitForSessionCard(sessionName: string, options?: { timeout?: number }) {
    await this.page.waitForSelector(`${this.selectors.sessionCard}:has-text("${sessionName}")`, {
      state: 'visible',
      timeout: options?.timeout || 5000,
    });
  }

  async getSessionCard(sessionName: string) {
    return this.page.locator(`${this.selectors.sessionCard}:has-text("${sessionName}")`);
  }

  async closeAnyOpenModal() {
    try {
      // Check for multiple modal selectors
      const modalSelectors = ['.modal-content', '[role="dialog"]', '.modal-positioned'];

      for (const selector of modalSelectors) {
        const modal = this.page.locator(selector).first();
        if (await modal.isVisible({ timeout: 500 })) {
          console.log(`Found open modal with selector: ${selector}`);

          // First try Escape key (most reliable)
          await this.page.keyboard.press('Escape');

          // Wait for modal animation to complete
          await this.page.waitForFunction(
            () => {
              const modal = document.querySelector('[role="dialog"], .modal');
              return (
                !modal ||
                getComputedStyle(modal).opacity === '0' ||
                getComputedStyle(modal).display === 'none'
              );
            },
            { timeout: TIMEOUTS.UI_ANIMATION }
          );

          // Check if modal is still visible
          if (await modal.isVisible({ timeout: 500 })) {
            console.log('Escape key did not close modal, trying close button');
            // Try to close via cancel button or X button
            const closeButton = this.page
              .locator('button[aria-label="Close modal"]')
              .or(this.page.locator('button:has-text("Cancel")'))
              .or(this.page.locator('.modal-content button:has(svg)'))
              .first();

            if (await closeButton.isVisible({ timeout: 500 })) {
              await closeButton.click({ force: true });
            }
          }

          // Wait for modal to disappear
          await this.page.waitForSelector(selector, { state: 'hidden', timeout: 2000 });
          console.log(`Successfully closed modal with selector: ${selector}`);
        }
      }
    } catch (_error) {
      // Modal might not exist or already closed, which is fine
      console.log('No modal to close or already closed');
    }
  }

  async closeAnyOpenModals() {
    // Alias for backward compatibility
    await this.closeAnyOpenModal();
  }
}
