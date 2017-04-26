import ACTION_TYPES from '../actions/actionTypes';

const initialState = {
  processing: false,
  error: {}
};

const mail = (state = initialState, action) => {
  switch (action.type) {
    case ACTION_TYPES.SET_MAIL_PROCESSING: {
      return { ...state, processing: true };
    }
    case ACTION_TYPES.CANCEL_COMPOSE: {
      return { ...state, error: Object.assign({}) };
    }
    case ACTION_TYPES.CLEAR_MAIL_PROCESSING: {
      return { ...state, processing: false };
    }
    default: {
      return state;
    }
  }
};

export default mail;
