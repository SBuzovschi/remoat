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

    const containers = Array.from(panel.querySelectorAll('[role="dialog"], .modal, .dialog, .notify-user-container, div[class*="rounded-2xl"], div[class*="rounded-xl"], div[class*="rounded-lg"], div[class*="border"][class*="rounded-lg"]'))
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
            return [
                'submit', 'confirm', 'send', 'done', 'ok', 'answer', 'select', 'choose',
                '送信', '決定', '回答', '確定', '完了',
                'отправить', 'подтвердить', 'готово', 'ок', 'ответить', 'выбрать', 'далее'
            ].some(p => t === p || t.includes(p));
        });

        if (inputs.length > 0 && submitBtn) {
            const options = [];
            for (let i = 0; i < inputs.length; i++) {
                const input = inputs[i];
                let labelText = '';
                
                const label = input.closest('label');
                if (label) {
                    labelText = (label.textContent || '').trim();
                } else if (input.id) {
                    const assocLabel = container.querySelector('label[for="' + input.id + '"]') || document.querySelector('label[for="' + input.id + '"]');
                    if (assocLabel) {
                        labelText = (assocLabel.textContent || '').trim();
                    }
                }

                if (!labelText) {
                    const parent = input.parentElement;
                    if (parent) {
                        const childLabel = parent.querySelector('label');
                        if (childLabel) {
                            labelText = (childLabel.textContent || '').trim();
                        } else {
                            labelText = Array.from(parent.childNodes)
                                .filter(n => n.nodeType === 3)
                                .map(n => (n.textContent || '').trim())
                                .join(' ');
                            if (!labelText) {
                                labelText = (parent.textContent || '').trim();
                            }
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
    submitText: string | null,
    writeInText?: string
): string {
    const safeText = JSON.stringify(optionText);
    const safeSubmitText = submitText ? JSON.stringify(submitText) : 'null';
    const safeWriteInText = writeInText ? JSON.stringify(writeInText) : 'null';

    return `(() => {
        try {
            const panel = document.querySelector('.antigravity-agent-side-panel') || document;
            const containers = Array.from(panel.querySelectorAll('[role="dialog"], .modal, .dialog, .notify-user-container, div[class*="rounded-2xl"], div[class*="rounded-xl"], div[class*="rounded-lg"], div[class*="border"][class*="rounded-lg"]'))
                .filter(el => el.offsetParent !== null);

            const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
            const wantedText = ${safeText};
            const wantedSubmit = ${safeSubmitText};
            const writeInVal = ${safeWriteInText};

            // Let's first search all containers for one that has an input or button matching wantedText.
            let bestContainer = null;
            let targetInput = null;
            let targetBtn = null;

            // 1. Try to find by text match first across all containers
            for (const container of containers) {
                const inputs = Array.from(container.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'))
                    .filter(el => el.offsetParent !== null);

                // Find input by label text
                const foundInput = inputs.find(input => {
                    let labelText = '';
                    const label = input.closest('label');
                    if (label) {
                        labelText = label.textContent || '';
                    } else if (input.id) {
                        const assocLabel = container.querySelector('label[for="' + input.id + '"]') || document.querySelector('label[for="' + input.id + '"]');
                        if (assocLabel) labelText = assocLabel.textContent || '';
                    }
                    if (!labelText && input.parentElement) {
                        const childLabel = input.parentElement.querySelector('label');
                        if (childLabel) {
                            labelText = childLabel.textContent || '';
                        } else {
                            labelText = input.parentElement.textContent || '';
                        }
                    }
                    return normalize(labelText).includes(normalize(wantedText));
                });

                if (foundInput) {
                    bestContainer = container;
                    targetInput = foundInput;
                    break;
                }

                // If not found in inputs, try to find in buttons
                const buttons = Array.from(container.querySelectorAll('button'))
                    .filter(btn => btn.offsetParent !== null);
                
                const choiceButtons = buttons.filter(btn => {
                    const t = (btn.textContent || '').trim();
                    if (!t || t.length > 50) return false;
                    const classes = normalize(btn.className || '');
                    if (classes.includes('icon') || classes.includes('close') || classes.includes('collapse')) return false;
                    return true;
                });

                const foundBtn = choiceButtons.find(btn => normalize(btn.textContent || '').includes(normalize(wantedText)));
                if (foundBtn) {
                    bestContainer = container;
                    targetBtn = foundBtn;
                    break;
                }
            }

            // 2. If no text match was found, fall back to matching by index across containers
            if (!targetInput && !targetBtn) {
                for (const container of containers) {
                    const inputs = Array.from(container.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'))
                        .filter(el => el.offsetParent !== null);

                    const buttons = Array.from(container.querySelectorAll('button'))
                        .filter(btn => btn.offsetParent !== null);

                    const submitBtn = buttons.find(btn => {
                        const t = normalize(btn.textContent || '');
                        return [
                            'submit', 'confirm', 'send', 'done', 'ok', 'answer', 'select', 'choose',
                            '送信', '決定', '回答', '確定', '完了',
                            'отправить', 'подтвердить', 'готово', 'ок', 'ответить', 'выбрать', 'далее'
                        ].some(p => t === p || t.includes(p));
                    });

                    if (inputs.length > 0 && submitBtn) {
                        targetInput = inputs[${optionIndex}];
                        if (targetInput) {
                            bestContainer = container;
                            break;
                        }
                    }

                    const choiceButtons = buttons.filter(btn => {
                        const t = (btn.textContent || '').trim();
                        if (!t || t.length > 50) return false;
                        const classes = normalize(btn.className || '');
                        if (classes.includes('icon') || classes.includes('close') || classes.includes('collapse')) return false;
                        return true;
                    });

                    if (choiceButtons.length >= 2) {
                        targetBtn = choiceButtons[${optionIndex}];
                        if (targetBtn) {
                            bestContainer = container;
                            break;
                        }
                    }
                }
            }

            // Now perform the action on the matched element
            if (targetInput) {
                // Click label if it exists to ensure synthetic events in React trigger
                const label = targetInput.closest('label');
                if (label) {
                    try { label.click(); } catch (e) {}
                }

                // Select/Check the input using React value tracker bypass
                try {
                    if (targetInput.tagName === 'INPUT') {
                        const nativeCheckedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
                        if (nativeCheckedSetter) {
                            nativeCheckedSetter.call(targetInput, true);
                        } else {
                            targetInput.checked = true;
                        }
                    } else {
                        // For custom role="checkbox"/"radio" divs
                        targetInput.setAttribute('aria-checked', 'true');
                    }
                } catch (e) {}

                try { targetInput.click(); } catch (e) {}
                try {
                    targetInput.dispatchEvent(new Event('click', { bubbles: true }));
                    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (e) {}

                let writeInSuccess = false;
                if (writeInVal !== null) {
                    const parent = targetInput.closest('label, div, p, li') || targetInput.parentElement;
                    let textInput = parent ? parent.querySelector('input[type="text"], input:not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"]), textarea') : null;
                    if (!textInput && parent) {
                        const nextSibs = Array.from(parent.parentElement ? parent.parentElement.children : []);
                        const indexInParent = nextSibs.indexOf(parent);
                        if (indexInParent !== -1) {
                            for (let j = indexInParent; j < nextSibs.length && j < indexInParent + 2; j++) {
                                textInput = nextSibs[j].querySelector('input[type="text"], input:not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"]), textarea');
                                if (textInput) break;
                            }
                        }
                    }
                    if (textInput) {
                        try {
                            textInput.focus();
                            const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                            if (nativeValueSetter) {
                                nativeValueSetter.call(textInput, writeInVal);
                            } else {
                                textInput.value = writeInVal;
                            }
                            textInput.dispatchEvent(new Event('input', { bubbles: true }));
                            textInput.dispatchEvent(new Event('change', { bubbles: true }));
                            writeInSuccess = true;
                        } catch (e) {}
                    }
                }

                let submitBtnFound = false;
                if (!${isMultiSelect} && wantedSubmit) {
                    const containerToSearch = bestContainer || document;
                    const buttons = Array.from(containerToSearch.querySelectorAll('button'))
                        .filter(btn => btn.offsetParent !== null);

                    const submitBtn = buttons.find(btn => {
                        const t = normalize(btn.textContent || '');
                        return normalize(wantedSubmit).includes(t) || t.includes(normalize(wantedSubmit)) ||
                            [
                                'submit', 'confirm', 'send', 'done', 'ok', 'answer', 'select', 'choose',
                                '送信', '決定', '回答', '確定', '完了',
                                'отправить', 'подтвердить', 'готово', 'ок', 'ответить', 'выбрать', 'далее'
                            ].some(p => t === p || t.includes(p));
                    });
                    if (submitBtn) {
                        submitBtnFound = true;
                        setTimeout(() => {
                            try {
                                // Ensure it's not disabled, or force enable it to bypass React propagation delays
                                submitBtn.disabled = false;
                                submitBtn.click();
                            } catch (e) {}
                        }, 150);
                    }
                }
                return { ok: true, type: 'input_clicked', writeInSuccess, submitBtnFound };
            }

            if (targetBtn) {
                targetBtn.click();
                return { ok: true, type: 'button_clicked' };
            }

            return { ok: false, error: 'Option not found' };
        } catch (globalError) {
            return { ok: false, error: globalError.message || String(globalError) };
        }
    })()`;
}

/**
 * Script to check if a specific question option has an associated text input field.
 */
export function buildProbeQuestionOptionScript(optionIndex: number, optionText?: string): string {
    const safeText = optionText ? JSON.stringify(optionText) : 'null';
    return `(() => {
        const panel = document.querySelector('.antigravity-agent-side-panel') || document;
        const containers = Array.from(panel.querySelectorAll('[role="dialog"], .modal, .dialog, .notify-user-container, div[class*="rounded-2xl"], div[class*="rounded-xl"], div[class*="rounded-lg"], div[class*="border"][class*="rounded-lg"]'))
            .filter(el => el.offsetParent !== null);

        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const wantedText = ${safeText};

        let targetInput = null;

        if (wantedText) {
            for (const container of containers) {
                const inputs = Array.from(container.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'))
                    .filter(el => el.offsetParent !== null);

                const foundInput = inputs.find(input => {
                    let labelText = '';
                    const label = input.closest('label');
                    if (label) {
                        labelText = label.textContent || '';
                    } else if (input.id) {
                        const assocLabel = container.querySelector('label[for="' + input.id + '"]') || document.querySelector('label[for="' + input.id + '"]');
                        if (assocLabel) labelText = assocLabel.textContent || '';
                    }
                    if (!labelText && input.parentElement) {
                        const childLabel = input.parentElement.querySelector('label');
                        if (childLabel) {
                            labelText = childLabel.textContent || '';
                        } else {
                            labelText = input.parentElement.textContent || '';
                        }
                    }
                    return normalize(labelText).includes(normalize(wantedText));
                });

                if (foundInput) {
                    targetInput = foundInput;
                    break;
                }
            }
        }

        if (!targetInput) {
            for (const container of containers) {
                const inputs = Array.from(container.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'))
                    .filter(el => el.offsetParent !== null);

                if (inputs.length > 0) {
                    targetInput = inputs[${optionIndex}];
                    if (targetInput) break;
                }
            }
        }

        if (targetInput) {
            const parent = targetInput.closest('label, div, p, li') || targetInput.parentElement;
            const textInput = parent ? parent.querySelector('input[type="text"], input:not([type="radio"]):not([type="checkbox"]):not([type="submit"]):not([type="button"]), textarea') : null;
            return { ok: true, hasTextInput: !!textInput };
        }
        return { ok: false, hasTextInput: false };
    })()`;
}

/**
 * Click submit button in the IDE webview.
 */
export function buildClickQuestionSubmitScript(submitText: string): string {
    const safeSubmitText = JSON.stringify(submitText);
    return `(() => {
        try {
            const panel = document.querySelector('.antigravity-agent-side-panel') || document;
            const containers = Array.from(panel.querySelectorAll('[role="dialog"], .modal, .dialog, .notify-user-container, div[class*="rounded-2xl"], div[class*="rounded-xl"], div[class*="rounded-lg"], div[class*="border"][class*="rounded-lg"]'))
                .filter(el => el.offsetParent !== null);

            const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
            const wantedSubmit = ${safeSubmitText};

            for (const container of containers) {
                const buttons = Array.from(container.querySelectorAll('button'))
                    .filter(btn => btn.offsetParent !== null);

                const submitBtn = buttons.find(btn => {
                    const t = normalize(btn.textContent || '');
                    return normalize(wantedSubmit).includes(t) || t.includes(normalize(wantedSubmit)) ||
                        [
                            'submit', 'confirm', 'send', 'done', 'ok', 'answer', 'select', 'choose',
                            '送信', '決定', '回答', '確定', '完了',
                            'отправить', 'подтвердить', 'готово', 'ок', 'ответить', 'выбрать', 'далее'
                        ].some(p => t === p || t.includes(p));
                });

                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.click();
                    return { ok: true };
                }
            }

            return { ok: false, error: 'Submit button not found' };
        } catch (globalError) {
            return { ok: false, error: globalError.message || String(globalError) };
        }
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
    async clickOption(optionIndex: number, optionText: string, isMultiSelect: boolean, submitText: string | null, writeInText?: string): Promise<boolean> {
        try {
            const expression = buildClickQuestionOptionScript(optionIndex, optionText, isMultiSelect, submitText, writeInText);
            const result = await this.runEvaluateScript(expression);
            if (result && !result.ok) {
                logger.error('[QuestionDetector] clickOption failed. Script result error:', result.error || JSON.stringify(result));
            } else if (!result) {
                logger.error('[QuestionDetector] clickOption returned null/undefined script result');
            } else {
                logger.info('[QuestionDetector] clickOption succeeded. Result:', JSON.stringify(result));
            }
            return result?.ok === true;
        } catch (error) {
            logger.error('[QuestionDetector] Error while clicking option:', error);
            return false;
        }
    }

    /**
     * Probe if a specific option has an associated text input field.
     */
    async probeOptionHasTextInput(optionIndex: number, optionText?: string): Promise<boolean> {
        try {
            const expression = buildProbeQuestionOptionScript(optionIndex, optionText);
            const result = await this.runEvaluateScript(expression);
            return result?.ok === true && result?.hasTextInput === true;
        } catch (error) {
            logger.error('[QuestionDetector] Error while probing option text input:', error);
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
            if (result && !result.ok) {
                logger.error('[QuestionDetector] clickSubmit failed. Script result error:', result.error || JSON.stringify(result));
            } else if (!result) {
                logger.error('[QuestionDetector] clickSubmit returned null/undefined script result');
            }
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
