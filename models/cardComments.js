CardComments = new Mongo.Collection('card_comments');

/**
 * A comment on a card
 */
CardComments.attachSchema(
  new SimpleSchema({
    boardId: {
      /**
       * the board ID
       */
      type: String,
    },
    cardId: {
      /**
       * the card ID
       */
      type: String,
    },
    // XXX Rename in `content`? `text` is a bit vague...
    text: {
      /**
       * the text of the comment
       */
      type: String,
    },
    createdAt: {
      /**
       * when was the comment created
       */
      type: Date,
      denyUpdate: false,
      // eslint-disable-next-line consistent-return
      autoValue() {
        if (this.isInsert) {
          return new Date();
        } else if (this.isUpsert) {
          return { $setOnInsert: new Date() };
        } else {
          this.unset();
        }
      },
    },
    modifiedAt: {
      type: Date,
      denyUpdate: false,
      // eslint-disable-next-line consistent-return
      autoValue() {
        if (this.isInsert || this.isUpsert || this.isUpdate) {
          return new Date();
        } else {
          this.unset();
        }
      },
    },
    // XXX Should probably be called `authorId`
    userId: {
      /**
       * the author ID of the comment
       */
      type: String,
      // eslint-disable-next-line consistent-return
      autoValue() {
        if (this.isInsert && !this.isSet) {
          return this.userId;
        }
      },
    },
  }),
);

CardComments.allow({
  insert(userId, doc) {
    return allowIsBoardMember(userId, Boards.findOne(doc.boardId));
  },
  update(userId, doc) {
    return userId === doc.userId;
  },
  remove(userId, doc) {
    return userId === doc.userId;
  },
  fetch: ['userId', 'boardId'],
});

CardComments.helpers({
  copy(newCardId) {
    this.cardId = newCardId;
    delete this._id;
    CardComments.insert(this);
  },

  user() {
    return Users.findOne(this.userId);
  },
});

CardComments.hookOptions.after.update = { fetchPrevious: false };

function commentCreation(userId, doc) {
  const card = Cards.findOne(doc.cardId);
  Activities.insert({
    userId,
    activityType: 'addComment',
    boardId: doc.boardId,
    cardId: doc.cardId,
    commentId: doc._id,
    listId: card.listId,
    swimlaneId: card.swimlaneId,
  });
}

if (Meteor.isServer) {
  // Comments are often fetched within a card, so we create an index to make these
  // queries more efficient.
  Meteor.startup(() => {
    CardComments._collection._ensureIndex({ modifiedAt: -1 });
    CardComments._collection._ensureIndex({ cardId: 1, createdAt: -1 });
  });

  CardComments.after.insert((userId, doc) => {
    commentCreation(userId, doc);
  });

  CardComments.after.update((userId, doc) => {
    const card = Cards.findOne(doc.cardId);
    Activities.insert({
      userId,
      activityType: 'editComment',
      boardId: doc.boardId,
      cardId: doc.cardId,
      commentId: doc._id,
      listId: card.listId,
      swimlaneId: card.swimlaneId,
    });
  });

  CardComments.before.remove((userId, doc) => {
    const card = Cards.findOne(doc.cardId);
    Activities.insert({
      userId,
      activityType: 'deleteComment',
      boardId: doc.boardId,
      cardId: doc.cardId,
      commentId: doc._id,
      listId: card.listId,
      swimlaneId: card.swimlaneId,
    });
  });

  CardComments.after.remove((userId, doc) => {
    const activity = Activities.findOne({ commentId: doc._id });
    if (activity) {
      Activities.remove(activity._id);
    }
  });
}

//CARD COMMENT REST API
if (Meteor.isServer) {
  /**
   * @operation get_all_comments
   * @summary Get all comments attached to a card
   *
   * @param {string} boardId the board ID of the card
   * @param {string} cardId the ID of the card
   * @return_type [{_id: string,
   *                comment: string,
   *                authorId: string}]
   */
  JsonRoutes.add('GET', '/api/boards/:boardId/cards/:cardId/comments', function(
    req,
    res,
  ) {
    try {
      Authentication.checkUserId(req.userId);
      const paramBoardId = req.params.boardId;
      const paramCardId = req.params.cardId;
      JsonRoutes.sendResult(res, {
        code: 200,
        data: CardComments.find({
          boardId: paramBoardId,
          cardId: paramCardId,
        }).map(function(doc) {
          return {
            _id: doc._id,
            comment: doc.text,
            authorId: doc.userId,
          };
        }),
      });
    } catch (error) {
      JsonRoutes.sendResult(res, {
        code: 200,
        data: error,
      });
    }
  });

  /**
   * @operation get_comment
   * @summary Get a comment on a card
   *
   * @param {string} boardId the board ID of the card
   * @param {string} cardId the ID of the card
   * @param {string} commentId the ID of the comment to retrieve
   * @return_type CardComments
   */
  JsonRoutes.add(
    'GET',
    '/api/boards/:boardId/cards/:cardId/comments/:commentId',
    function(req, res) {
      try {
        Authentication.checkUserId(req.userId);
        const paramBoardId = req.params.boardId;
        const paramCommentId = req.params.commentId;
        const paramCardId = req.params.cardId;
        JsonRoutes.sendResult(res, {
          code: 200,
          data: CardComments.findOne({
            _id: paramCommentId,
            cardId: paramCardId,
            boardId: paramBoardId,
          }),
        });
      } catch (error) {
        JsonRoutes.sendResult(res, {
          code: 200,
          data: error,
        });
      }
    },
  );

  /**
   * @operation new_comment
   * @summary Add a comment on a card
   *
   * @param {string} boardId the board ID of the card
   * @param {string} cardId the ID of the card
   * @param {string} authorId the user who 'posted' the comment
   * @param {string} text the content of the comment
   * @return_type {_id: string}
   */
  JsonRoutes.add(
    'POST',
    '/api/boards/:boardId/cards/:cardId/comments',
    function(req, res) {
      try {
        Authentication.checkUserId(req.userId);
        const paramBoardId = req.params.boardId;
        const paramCardId = req.params.cardId;
        const id = CardComments.direct.insert({
          userId: req.body.authorId,
          text: req.body.comment,
          cardId: paramCardId,
          boardId: paramBoardId,
        });

        JsonRoutes.sendResult(res, {
          code: 200,
          data: {
            _id: id,
          },
        });

        const cardComment = CardComments.findOne({
          _id: id,
          cardId: paramCardId,
          boardId: paramBoardId,
        });
        commentCreation(req.body.authorId, cardComment);
      } catch (error) {
        JsonRoutes.sendResult(res, {
          code: 200,
          data: error,
        });
      }
    },
  );

  /**
   * @operation delete_comment
   * @summary Delete a comment on a card
   *
   * @param {string} boardId the board ID of the card
   * @param {string} cardId the ID of the card
   * @param {string} commentId the ID of the comment to delete
   * @return_type {_id: string}
   */
  JsonRoutes.add(
    'DELETE',
    '/api/boards/:boardId/cards/:cardId/comments/:commentId',
    function(req, res) {
      try {
        Authentication.checkUserId(req.userId);
        const paramBoardId = req.params.boardId;
        const paramCommentId = req.params.commentId;
        const paramCardId = req.params.cardId;
        CardComments.remove({
          _id: paramCommentId,
          cardId: paramCardId,
          boardId: paramBoardId,
        });
        JsonRoutes.sendResult(res, {
          code: 200,
          data: {
            _id: paramCardId,
          },
        });
      } catch (error) {
        JsonRoutes.sendResult(res, {
          code: 200,
          data: error,
        });
      }
    },
  );
}

export default CardComments;
