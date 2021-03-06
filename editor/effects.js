/**
 * External dependencies
 */
import { BEGIN, COMMIT, REVERT } from 'redux-optimist';
import { get, map, filter, some, castArray } from 'lodash';

/**
 * WordPress dependencies
 */
import {
	parse,
	getBlockType,
	switchToBlockType,
	createBlock,
	serialize,
	createReusableBlock,
} from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { getPostEditUrl, getWPAdminURL } from './utils/url';
import {
	resetPost,
	setupNewPost,
	resetBlocks,
	focusBlock,
	replaceBlocks,
	createSuccessNotice,
	createErrorNotice,
	removeNotice,
	savePost,
	editPost,
	requestMetaBoxUpdates,
	updateReusableBlock,
	saveReusableBlock,
} from './actions';
import {
	getCurrentPost,
	getCurrentPostType,
	getDirtyMetaBoxes,
	getEditedPostContent,
	getPostEdits,
	isCurrentPostPublished,
	isEditedPostDirty,
	isEditedPostNew,
	isEditedPostSaveable,
	getMetaBoxes,
	getBlock,
	getReusableBlock,
} from './selectors';

const SAVE_POST_NOTICE_ID = 'SAVE_POST_NOTICE_ID';
const TRASH_POST_NOTICE_ID = 'TRASH_POST_NOTICE_ID';
const SAVE_REUSABLE_BLOCK_NOTICE_ID = 'SAVE_REUSABLE_BLOCK_NOTICE_ID';
export const POST_UPDATE_TRANSACTION_ID = 'post-update';

export default {
	REQUEST_POST_UPDATE( action, store ) {
		const { dispatch, getState } = store;
		const state = getState();
		const post = getCurrentPost( state );
		const edits = getPostEdits( state );
		const toSend = {
			...edits,
			content: getEditedPostContent( state ),
			id: post.id,
		};

		dispatch( {
			type: 'UPDATE_POST',
			edits: toSend,
			optimist: { type: BEGIN, id: POST_UPDATE_TRANSACTION_ID },
		} );
		dispatch( removeNotice( SAVE_POST_NOTICE_ID ) );
		const Model = wp.api.getPostTypeModel( getCurrentPostType( state ) );
		new Model( toSend ).save().done( ( newPost ) => {
			dispatch( {
				type: 'RESET_POST',
				post: newPost,
			} );
			dispatch( {
				type: 'REQUEST_POST_UPDATE_SUCCESS',
				previousPost: post,
				post: newPost,
				optimist: { type: COMMIT, id: POST_UPDATE_TRANSACTION_ID },
			} );
		} ).fail( ( err ) => {
			dispatch( {
				type: 'REQUEST_POST_UPDATE_FAILURE',
				error: get( err, 'responseJSON', {
					code: 'unknown_error',
					message: __( 'An unknown error occurred.' ),
				} ),
				post,
				edits,
				optimist: { type: REVERT, id: POST_UPDATE_TRANSACTION_ID },
			} );
		} );
	},
	REQUEST_POST_UPDATE_SUCCESS( action, store ) {
		const { previousPost, post } = action;
		const { dispatch, getState } = store;

		const publishStatus = [ 'publish', 'private', 'future' ];
		const isPublished = publishStatus.indexOf( previousPost.status ) !== -1;
		const messages = {
			publish: __( 'Post published!' ),
			private: __( 'Post published privately!' ),
			future: __( 'Post scheduled!' ),
		};

		// If we save a non published post, we don't show any notice
		// If we publish/schedule a post, we show the corresponding publish message
		// Unless we show an update notice
		if ( isPublished || publishStatus.indexOf( post.status ) !== -1 ) {
			const noticeMessage = ! isPublished && publishStatus.indexOf( post.status ) !== -1 ?
				messages[ post.status ] :
				__( 'Post updated!' );
			dispatch( createSuccessNotice(
				<p>
					<span>{ noticeMessage }</span>
					{ ' ' }
					<a href={ post.link }>{ __( 'View post' ) }</a>
				</p>,
				{ id: SAVE_POST_NOTICE_ID }
			) );
		}

		// Update dirty meta boxes.
		dispatch( requestMetaBoxUpdates( getDirtyMetaBoxes( getState() ) ) );

		if ( get( window.history.state, 'id' ) !== post.id ) {
			window.history.replaceState(
				{ id: post.id },
				'Post ' + post.id,
				getPostEditUrl( post.id )
			);
		}
	},
	REQUEST_POST_UPDATE_FAILURE( action, store ) {
		const { post, edits } = action;
		const { dispatch } = store;

		const publishStatus = [ 'publish', 'private', 'future' ];
		const isPublished = publishStatus.indexOf( post.status ) !== -1;
		// If the post was being published, we show the corresponding publish error message
		// Unless we publish an "updating failed" message
		const messages = {
			publish: __( 'Publishing failed' ),
			private: __( 'Publishing failed' ),
			future: __( 'Scheduling failed' ),
		};
		const noticeMessage = ! isPublished && publishStatus.indexOf( edits.status ) !== -1 ?
			messages[ edits.status ] :
			__( 'Updating failed' );
		dispatch( createErrorNotice( noticeMessage, { id: SAVE_POST_NOTICE_ID } ) );
	},
	TRASH_POST( action, store ) {
		const { dispatch, getState } = store;
		const { postId } = action;
		const Model = wp.api.getPostTypeModel( getCurrentPostType( getState() ) );
		dispatch( removeNotice( TRASH_POST_NOTICE_ID ) );
		new Model( { id: postId } ).destroy().then(
			() => {
				dispatch( {
					...action,
					type: 'TRASH_POST_SUCCESS',
				} );
			},
			( err ) => {
				dispatch( {
					...action,
					type: 'TRASH_POST_FAILURE',
					error: get( err, 'responseJSON', {
						code: 'unknown_error',
						message: __( 'An unknown error occurred.' ),
					} ),
				} );
			}
		);
	},
	TRASH_POST_SUCCESS( action ) {
		const { postId, postType } = action;

		// Delay redirect to ensure store has been updated with the successful trash.
		setTimeout( () => {
			window.location.href = getWPAdminURL( 'edit.php', {
				trashed: 1,
				post_type: postType,
				ids: postId,
			} );
		} );
	},
	TRASH_POST_FAILURE( action, store ) {
		const message = action.error.message && action.error.code !== 'unknown_error' ? action.error.message : __( 'Trashing failed' );
		store.dispatch( createErrorNotice( message, { id: TRASH_POST_NOTICE_ID } ) );
	},
	MERGE_BLOCKS( action, store ) {
		const { dispatch } = store;
		const [ blockA, blockB ] = action.blocks;
		const blockType = getBlockType( blockA.name );

		// Only focus the previous block if it's not mergeable
		if ( ! blockType.merge ) {
			dispatch( focusBlock( blockA.uid ) );
			return;
		}

		// We can only merge blocks with similar types
		// thus, we transform the block to merge first
		const blocksWithTheSameType = blockA.name === blockB.name ?
			[ blockB ] :
			switchToBlockType( blockB, blockA.name );

		// If the block types can not match, do nothing
		if ( ! blocksWithTheSameType || ! blocksWithTheSameType.length ) {
			return;
		}

		// Calling the merge to update the attributes and remove the block to be merged
		const updatedAttributes = blockType.merge(
			blockA.attributes,
			blocksWithTheSameType[ 0 ].attributes
		);

		dispatch( focusBlock( blockA.uid, { offset: -1 } ) );
		dispatch( replaceBlocks(
			[ blockA.uid, blockB.uid ],
			[
				{
					...blockA,
					attributes: {
						...blockA.attributes,
						...updatedAttributes,
					},
				},
				...blocksWithTheSameType.slice( 1 ),
			]
		) );
	},
	AUTOSAVE( action, store ) {
		const { getState, dispatch } = store;
		const state = getState();
		if ( ! isEditedPostSaveable( state ) ) {
			return;
		}

		if ( ! isEditedPostNew( state ) && ! isEditedPostDirty( state ) ) {
			return;
		}

		if ( isCurrentPostPublished( state ) ) {
			// TODO: Publish autosave.
			//  - Autosaves are created as revisions for published posts, but
			//    the necessary REST API behavior does not yet exist
			//  - May need to check for whether the status of the edited post
			//    has changed from the saved copy (i.e. published -> pending)
			return;
		}

		// Change status from auto-draft to draft
		if ( isEditedPostNew( state ) ) {
			dispatch( editPost( { status: 'draft' } ) );
		}

		dispatch( savePost() );
	},
	SETUP_EDITOR( action ) {
		const { post, settings } = action;
		const effects = [];

		// Parse content as blocks
		if ( post.content.raw ) {
			effects.push( resetBlocks( parse( post.content.raw ) ) );
		} else if ( settings.template ) {
			const blocks = map( settings.template, ( [ name, attributes ] ) => {
				const block = createBlock( name );
				block.attributes = {
					...block.attributes,
					...attributes,
				};
				return block;
			} );
			effects.push( resetBlocks( blocks ) );
		}

		// Resetting post should occur after blocks have been reset, since it's
		// the post reset that restarts history (used in dirty detection).
		effects.push( resetPost( post ) );

		// Include auto draft title in edits while not flagging post as dirty
		if ( post.status === 'auto-draft' ) {
			effects.push( setupNewPost( {
				title: post.title.raw,
			} ) );
		}

		return effects;
	},
	INITIALIZE_META_BOX_STATE( action ) {
		// Hold jquery.ready until the metaboxes load
		const locations = [ 'normal', 'side' ];
		if ( some( locations, ( location ) => !! action.metaBoxes[ location ] ) ) {
			jQuery.holdReady( true );
		}
	},
	META_BOX_LOADED( action, store ) {
		const { getState } = store;
		const metaboxes = getMetaBoxes( getState() );
		const unloadedMetaboxes = filter(
			map( metaboxes, ( value, key ) => ( {
				...value,
				key,
			} ) ),
			( metabox ) => metabox.isActive && ! metabox.isLoaded
		);
		if ( unloadedMetaboxes.length === 1 && unloadedMetaboxes[ 0 ].key === action.location ) {
			jQuery.holdReady( false );
		}
	},
	FETCH_REUSABLE_BLOCKS( action, store ) {
		const { id } = action;
		const { dispatch } = store;

		let result;
		if ( id ) {
			result = new wp.api.models.ReusableBlocks( { id } ).fetch();
		} else {
			result = new wp.api.collections.ReusableBlocks().fetch();
		}

		result.then(
			( reusableBlockOrBlocks ) => {
				dispatch( {
					type: 'FETCH_REUSABLE_BLOCKS_SUCCESS',
					reusableBlocks: castArray( reusableBlockOrBlocks ).map( ( { id: itemId, name, content } ) => {
						const [ { name: type, attributes } ] = parse( content );
						return { id: itemId, name, type, attributes };
					} ),
				} );
			},
			( error ) => {
				dispatch( {
					type: 'FETCH_REUSABLE_BLOCKS_FAILURE',
					error: error.responseJSON || {
						code: 'unknown_error',
						message: __( 'An unknown error occurred.' ),
					},
				} );
			}
		);
	},
	SAVE_REUSABLE_BLOCK( action, store ) {
		const { id } = action;
		const { getState, dispatch } = store;

		const { name, type, attributes } = getReusableBlock( getState(), id );
		const content = serialize( createBlock( type, attributes ) );

		new wp.api.models.ReusableBlocks( { id, name, content } ).save().then(
			() => {
				dispatch( { type: 'SAVE_REUSABLE_BLOCK_SUCCESS', id } );
				dispatch( createSuccessNotice(
					__( 'Reusable block updated' ),
					{ id: SAVE_REUSABLE_BLOCK_NOTICE_ID }
				) );
			},
			( error ) => {
				dispatch( { type: 'SAVE_REUSABLE_BLOCK_FAILURE', id } );
				dispatch( createErrorNotice(
					get( error.responseJSON, 'message', __( 'An unknown error occured' ) ),
					{ id: SAVE_REUSABLE_BLOCK_NOTICE_ID }
				) );
			}
		);
	},
	CONVERT_BLOCK_TO_STATIC( action, store ) {
		const { getState, dispatch } = store;

		const oldBlock = getBlock( getState(), action.uid );
		const reusableBlock = getReusableBlock( getState(), oldBlock.attributes.ref );
		const newBlock = createBlock( reusableBlock.type, reusableBlock.attributes );
		dispatch( replaceBlocks( [ oldBlock.uid ], [ newBlock ] ) );
	},
	CONVERT_BLOCK_TO_REUSABLE( action, store ) {
		const { getState, dispatch } = store;

		const oldBlock = getBlock( getState(), action.uid );
		const reusableBlock = createReusableBlock( oldBlock.name, oldBlock.attributes );
		const newBlock = createBlock( 'core/reusable-block', { ref: reusableBlock.id } );
		dispatch( updateReusableBlock( reusableBlock.id, reusableBlock ) );
		dispatch( saveReusableBlock( reusableBlock.id ) );
		dispatch( replaceBlocks( [ oldBlock.uid ], [ newBlock ] ) );
	},
};
