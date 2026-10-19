import { TeamPulseQuestionKindEnum } from '../enum/team-pulse.enum';

// Fewer answers than this and results stay hidden: in a small team, one person's answers would be obvious.
export const MIN_RESPONSES_TO_SHOW = 3;
export const MAX_QUESTIONS = 6;
export const MAX_COMMENT_LENGTH = 500;
// Trend lines show at most this many past rounds.
export const TREND_ROUNDS = 12;

const rating = (text: string) => ({
  kind: TeamPulseQuestionKindEnum.RATING,
  text,
});
const comment = (text: string) => ({
  kind: TeamPulseQuestionKindEnum.TEXT,
  text,
});

export const TEAM_PULSE_TEMPLATES = [
  {
    key: 'after-service',
    title: 'After the service',
    description: 'A quick look back after each service you serve at.',
    questions: [
      rating('How well did we serve today?'),
      rating('How prepared were we?'),
      rating('How well did we work together?'),
      comment('What should we do differently next time?'),
    ],
  },
  {
    key: 'team-health',
    title: 'Team health',
    description: 'A monthly check on how the team is doing.',
    questions: [
      rating('How clear was communication this month?'),
      rating('How supported do you feel by the team?'),
      rating('How are we growing as a team?'),
      comment('One thing that would help us'),
    ],
  },
  {
    key: 'event-review',
    title: 'Event review',
    description: 'After a special event or programme.',
    questions: [
      rating('How well did the event go for our team?'),
      rating('How well were we organised?'),
      comment('What worked well?'),
      comment('What should we change next time?'),
    ],
  },
];
