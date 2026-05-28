import { QuestionDetector, QuestionInfo } from '../../src/services/questionDetector';
import { CdpService } from '../../src/services/cdpService';

// Mock CdpService
jest.mock('../../src/services/cdpService');
const MockedCdpService = CdpService as jest.MockedClass<typeof CdpService>;

describe('QuestionDetector - multiple-choice and button-choices question detection', () => {
    let detector: QuestionDetector;
    let mockCdpService: jest.Mocked<CdpService>;

    beforeEach(() => {
        jest.useFakeTimers();
        mockCdpService = new MockedCdpService() as jest.Mocked<CdpService>;
        mockCdpService.getPrimaryContextId = jest.fn().mockReturnValue(42);
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (detector) {
            await detector.stop();
        }
        jest.useRealTimers();
    });

    /** Helper to generate QuestionInfo for testing */
    function makeQuestionInfo(overrides: Partial<QuestionInfo> = {}): QuestionInfo {
        return {
            type: 'multiple_choice',
            question: 'Which framework do you prefer?',
            options: [
                { text: 'Next.js', index: 0, isMultiSelect: false },
                { text: 'Vite', index: 1, isMultiSelect: false },
            ],
            submitText: 'Answer',
            ...overrides,
        };
    }

    // Test 1: Callback on detection
    it('calls the onQuestionRequired callback when a question is detected', async () => {
        const onQuestionRequired = jest.fn();
        const mockInfo = makeQuestionInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo }
        });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onQuestionRequired).toHaveBeenCalledTimes(1);
        expect(onQuestionRequired).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'multiple_choice',
                question: 'Which framework do you prefer?',
                submitText: 'Answer',
            })
        );
    });

    // Test 2: Do not call the callback when no question exists
    it('does not call the callback when no question is detected', async () => {
        const onQuestionRequired = jest.fn();
        mockCdpService.call.mockResolvedValue({ result: { value: null } });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500);

        expect(onQuestionRequired).not.toHaveBeenCalled();
    });

    // Test 3: No duplicate calls for consecutive duplicate detections
    it('does not call the callback multiple times when the same question is detected consecutively', async () => {
        const onQuestionRequired = jest.fn();
        const mockInfo = makeQuestionInfo();

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo }
        });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired,
        });
        detector.start();

        // 3 polling cycles
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);
        await jest.advanceTimersByTimeAsync(500);

        expect(onQuestionRequired).toHaveBeenCalledTimes(1);
    });

    // Test 4: clickOption executes script via CDP
    it('executes a click option script via CDP when clickOption() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } }
        });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired: jest.fn(),
        });

        const result = await detector.clickOption(0, 'Next.js', false, 'Answer');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Next.js'),
                returnByValue: true,
                contextId: 42,
            })
        );
    });

    // Test 5: clickSubmit executes submit script via CDP
    it('executes a submit script via CDP when clickSubmit() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } }
        });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired: jest.fn(),
        });

        const result = await detector.clickSubmit('Answer');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Answer'),
                returnByValue: true,
                contextId: 42,
            })
        );
    });

    // Test 6: onResolved fires when question disappears
    it('calls onResolved when the question disappears after being detected', async () => {
        const onResolved = jest.fn();
        const mockInfo = makeQuestionInfo();

        mockCdpService.call
            .mockResolvedValueOnce({ result: { value: mockInfo } })  // 1st: detected
            .mockResolvedValueOnce({ result: { value: null } });     // 2nd: disappeared

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired: jest.fn(),
            onResolved,
        });
        detector.start();

        await jest.advanceTimersByTimeAsync(500); // 1st poll
        expect(onResolved).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(500); // 2nd poll
        expect(onResolved).toHaveBeenCalledTimes(1);
    });

    // Test 7: getLastDetectedInfo returns info
    it('getLastDetectedInfo() returns the currently detected question info', async () => {
        const mockInfo = makeQuestionInfo({ question: 'Test Question' });

        mockCdpService.call.mockResolvedValue({
            result: { value: mockInfo }
        });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired: jest.fn(),
        });

        expect(detector.getLastDetectedInfo()).toBeNull();

        detector.start();
        await jest.advanceTimersByTimeAsync(500);

        const info = detector.getLastDetectedInfo();
        expect(info).not.toBeNull();
        expect(info?.question).toBe('Test Question');
    });

    // Test 8: probeOptionHasTextInput executes probe script via CDP
    it('executes a probe script via CDP when probeOptionHasTextInput() is called', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true, hasTextInput: true } }
        });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired: jest.fn(),
        });

        const result = await detector.probeOptionHasTextInput(1);

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('hasTextInput'),
                returnByValue: true,
                contextId: 42,
            })
        );
    });

    // Test 9: clickOption with writeInText includes it in evaluation script
    it('includes writeInText in the script expression when clickOption() is called with writeInText', async () => {
        mockCdpService.call.mockResolvedValue({
            result: { value: { ok: true } }
        });

        detector = new QuestionDetector({
            cdpService: mockCdpService,
            pollIntervalMs: 500,
            onQuestionRequired: jest.fn(),
        });

        const result = await detector.clickOption(0, 'Next.js', false, 'Answer', 'Custom text answer');

        expect(result).toBe(true);
        expect(mockCdpService.call).toHaveBeenCalledWith(
            'Runtime.evaluate',
            expect.objectContaining({
                expression: expect.stringContaining('Custom text answer'),
                returnByValue: true,
                contextId: 42,
            })
        );
    });
});
