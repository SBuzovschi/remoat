import { logger } from '../utils/logger';
import { CdpService } from './cdpService';

/** Multiple-choice question option info */
export interface QuestionOption {
    /** Label/text of the option */
    text: string;
    /** 0-based index of the option in the DOM list */
    index: number;
    /** True if option is a checkbox (multi-select), false if radio button */
    isMultiSelect: boolean;
}

/** Information about detected question prompt */
export interface QuestionInfo {
    /** Type of question detected */
    type: 'multiple_choice' | 'button_choices';
    /** Text of the question */
    question: string;
    /** List of options */
    options: QuestionOption[];
    /** Submit button text (if any) */
    submitText: string | null;
}

export interface QuestionDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 2000ms) */
    pollIntervalMs?: number;
    /** Callback when a question is detected */
    onQuestionRequired: (info: QuestionInfo) => void;
    /** Callback when the question is resolved (disappeared) */
    onResolved?: () => void;
}

/**
 * Question detection script for the Antigravity UI.
 *
 * Scans visible cards and dialogs in the side panel for:
 *   1. Checkboxes or radio buttons with a visible submit button.
 *   2. Compact groups of standalone choice buttons (e.g. Yes/No, Option 1/Option 2).
 *
 * Automatically skips containers handled by other detectors (Approval/Planning).
 */
const DETECT_QUESTION_SCRIPT = `(() => {
    const panel = document.querySelector('.antigravity-agent-side-panel') || document;

    const containers = Array.from(panel.querySelectorAll('[role="dialog"], .modal, .dialog, .notify-user-container, div[class*="border"][class*="rounded-lg"]'))
        .filter(el => el.offsetParent !== null);

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    for (const container of containers) {
        const textContentLower = normalize(container.textContent || '');
        
        // Exclude elements managed by ApprovalDetector
        if (textContentLower.includes('allow once') || textContentLower.includes('always allow') || textContentLower.includes('allow this conversation')) {
            continue;
        }
        
        // Exclude elements managed by PlanningDetector
        if (textContentLower.includes('proceed') || textContentLower.includes('implementation plan')) {
            continue;
        }

        // 1. Check for checkbox/radio inputs with a submit button
        const inputs = Array.from(container.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'))
            .filter(el => el.offsetParent !== null);

        const buttons = Array.from(container.querySelectorAll('button'))
            .filter(btn => btn.offsetParent !== null);

        const submitBtn = buttons.find(btn => {
            const t = normalize(btn.textContent || '');
            return ['submit', 'confirm', 'send', 'done', 'ok', '送信', '決定', '回答'].some(p => t === p || t.includes(p));
        });

        if (inputs.length > 0 && submitBtn) {
            const options = [];
            for (let i = 0; i < inputs.length; i++) {
                const input = inputs[i];
                let labelText = '';
                
                const label = input.closest('label');
                if (label) {
                    labelText = (label.textContent || '').trim();
                } else {
                    const parent = input.parentElement;
                    if (parent) {
                        labelText = Array.from(parent.childNodes)
                            .filter(n => n.nodeType === 3)
                            .map(n => (n.textContent || '').trim())
                            .join(' ');
                        if (!labelText) {
                            labelText = (parent.textContent || '').trim();
                        }
                    }
                }

                if (!labelText) {
                    labelText = input.getAttribute('aria-label') || input.getAttribute('title') || '';
                }

                labelText = labelText.replace(/submit|confirm|send/gi, '').trim();
                if (!labelText) labelText = \`Option \${i + 1}\`;

                const isCheckbox = input.type === 'checkbox' || input.getAttribute('role') === 'checkbox';
                options.push({
                    text: labelText,
                    index: i,
                    isMultiSelect: isCheckbox
                });
            }

            const titleEl = container.querySelector('h1, h2, h3, h4, strong, p, [class*="title"], [class*="heading"]');
            const questionText = titleEl ? (titleEl.textContent || '').trim() : 'Question';

            return {
                type: 'multiple_choice',
                question: questionText,
                options,
                submitText: (submitBtn.textContent || '').trim()
            };
        }

        // 2. Check for standalone choice button groups
        const choiceButtons = buttons.filter(btn => {
            const t = (btn.textContent || '').trim();
            if (!t || t.length > 50) return false;
            const classes = normalize(btn.className || '');
            if (classes.includes('icon') || classes.includes('close') || classes.includes('collapse')) return false;
            return true;
        });

        if (choiceButtons.length >= 2) {
            const options = choiceButtons.map((btn, idx) => ({
                text: (btn.textContent || '').trim(),
                index: idx,
                isMultiSelect: false
            }));

            const titleEl = container.querySelector('h1, h2, h3, h4, strong, p, [class*="title"], [class*="heading"]');
            const questionText = titleEl ? (titleEl.textContent || '').trim() : 'Choose an option';

            return {
                type: 'button_choices',
                question: questionText,
                options,
                submitText: null
            };
        }
    }

    return null;
})()`;

/**
 * Click option in the IDE webview.
 */
export function buildClickQuestionOptionScript(
    optionIndex: number,
    optionText: string,
    isMultiSelect: boolean,
    submitText: string | null
): string {
    const safeText = JSON.stringify(optionText);
    const safeSubmitText = submitText ? JSON.stringify(submitText) : 'null';

    return `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel') || document;
        const containers = Array.from(panel.querySelectorAll('[role="dialog"], .modal, .dialog, .notify-user-container, div[class*="border"][class*="rounded-lg"]'))
            .filter(el => el.offsetParent !== null);

        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const wantedText = ${safeText};
        const wantedSubmit = ${safeSubmitText};

        for (const container of containers) {
            const inputs = Array.from(container.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'))
                .filter(el => el.offsetParent !== null);

            const buttons = Array.from(container.querySelectorAll('button'))
                .filter(btn => btn.offsetParent !== null);

            if (inputs.length > 0) {
                let targetInput = inputs[${optionIndex}];
                if (!targetInput) {
                    targetInput = inputs.find(input => {
                        let labelText = '';
                        const label = input.closest('label');
                        if (label) labelText = label.textContent || '';
                        else if (input.parentElement) labelText = input.parentElement.textContent || '';
                        return normalize(labelText).includes(normalize(wantedText));
                    });
                }

                if (targetInput) {
                    targetInput.click();
                    if (!isMultiSelect && wantedSubmit) {
                        const submitBtn = buttons.find(btn => {
                            const t = normalize(btn.textContent || '');
                            return normalize(wantedSubmit).includes(t) || t.includes(normalize(wantedSubmit)) ||
                                ['submit', 'confirm', 'send', 'done', 'ok', '送信', '決定', '回答'].some(p => t === p || t.includes(p));
                        });
                        if (submitBtn) {
                            setTimeout(() => { submitBtn.click(); }, 100);
                        }
                    }
                    return { ok: true, type: 'input_clicked' };
                }
            }

            const choiceButtons = buttons.filter(btn => {
                const t = (btn.textContent || '').trim();
                if (!t || t.length > 50) return false;
                const classes = normalize(btn.className || '');
                if (classes.includes('icon') || classes.includes('close') || classes.includes('collapse')) return false;
                return true;
            });

            let targetBtn = choiceButtons[${optionIndex}];
            if (!targetBtn) {
                targetBtn = choiceButtons.find(btn => normalize(btn.textContent || '').includes(normalize(wantedText)));
            }

            if (targetBtn) {
                targetBtn.click();
                return { ok: true, type: 'button_clicked' };
            }
        }

        return { ok: false, error: 'Option not found' };
    })()`;
}

/**
 * Click submit button in the IDE webview.
 */
export function buildClickQuestionSubmitScript(submitText: string): string {
    const safeSubmitText = JSON.stringify(submitText);
    return `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel') || document;
        const containers = Array.from(panel.querySelectorAll('[role="dialog"], .modal, .dialog, .notify-user-container, div[class*="border"][class*="rounded-lg"]'))
            .filter(el => el.offsetParent !== null);

        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const wantedSubmit = ${safeSubmitText};

        for (const container of containers) {
            const buttons = Array.from(container.querySelectorAll('button'))
                .filter(btn => btn.offsetParent !== null);

            const submitBtn = buttons.find(btn => {
                const t = normalize(btn.textContent || '');
                return normalize(wantedSubmit).includes(t) || t.includes(normalize(wantedSubmit)) ||
                    ['submit', 'confirm', 'send', 'done', 'ok', '送信', '決定', '回答'].some(p => t === p || t.includes(p));
            });

            if (submitBtn) {
                submitBtn.click();
                return { ok: true };
            }
        }

        return { ok: false, error: 'Submit button not found' };
    })()`;
}

/**
 * Class that detects multiple-choice questions or choice prompts in the Antigravity UI via polling.
 */
export class QuestionDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onQuestionRequired: (info: QuestionInfo) => void;
    private onResolved?: () => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private lastDetectedKey: string | null = null;
    private lastDetectedInfo: QuestionInfo | null = null;

    constructor(options: QuestionDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
        this.onQuestionRequired = options.onQuestionRequired;
        this.onResolved = options.onResolved;
    }

    /**
     * Start monitoring.
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.lastDetectedInfo = null;
        this.schedulePoll();
    }

    /**
     * Stop monitoring.
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Return the last detected question info.
     */
    getLastDetectedInfo(): QuestionInfo | null {
        return this.lastDetectedInfo;
    }

    /** Returns whether monitoring is active */
    isActive(): boolean {
        return this.isRunning;
    }

    /** Schedule next poll */
    private schedulePoll(): void {
        if (!this.isRunning) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    /**
     * Single poll iteration
     */
    private async poll(): Promise<void> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: DETECT_QUESTION_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: QuestionInfo | null = result?.result?.value ?? null;

            if (info) {
                const key = `${info.question}::${info.options.map(o => o.text).join('|')}`;
                if (key !== this.lastDetectedKey) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    Promise.resolve(this.onQuestionRequired(info)).catch((err) => {
                        logger.error('[QuestionDetector] onQuestionRequired callback failed:', err);
                    });
                }
            } else {
                const wasDetected = this.lastDetectedKey !== null;
                this.lastDetectedKey = null;
                this.lastDetectedInfo = null;
                if (wasDetected && this.onResolved) {
                    this.onResolved();
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected') || message.includes('WebSocket disconnected')) {
                return;
            }
            logger.error('[QuestionDetector] Error during polling:', error);
        }
    }

    /**
     * Select/Click a specific option.
     */
    async clickOption(optionIndex: number, optionText: string, isMultiSelect: boolean, submitText: string | null): Promise<boolean> {
        try {
            const expression = buildClickQuestionOptionScript(optionIndex, optionText, isMultiSelect, submitText);
            const result = await this.runEvaluateScript(expression);
            return result?.ok === true;
        } catch (error) {
            logger.error('[QuestionDetector] Error while clicking option:', error);
            return false;
        }
    }

    /**
     * Click the submit/answer button.
     */
    async clickSubmit(submitText: string): Promise<boolean> {
        try {
            const expression = buildClickQuestionSubmitScript(submitText);
            const result = await this.runEvaluateScript(expression);
            return result?.ok === true;
        } catch (error) {
            logger.error('[QuestionDetector] Error while clicking submit:', error);
            return false;
        }
    }

    private async runEvaluateScript(expression: string): Promise<any> {
        const contextId = this.cdpService.getPrimaryContextId();
        const callParams: Record<string, unknown> = {
            expression,
            returnByValue: true,
            awaitPromise: false,
        };
        if (contextId !== null) {
            callParams.contextId = contextId;
        }
        const result = await this.cdpService.call('Runtime.evaluate', callParams);
        return result?.result?.value;
    }
}
