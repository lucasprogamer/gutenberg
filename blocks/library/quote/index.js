/**
 * External dependencies
 */
import { isString } from 'lodash';

/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Toolbar } from '@wordpress/components';

/**
 * Internal dependencies
 */
import './style.scss';
import './editor.scss';
import { registerBlockType, createBlock } from '../../api';
import AlignmentToolbar from '../../alignment-toolbar';
import BlockControls from '../../block-controls';
import Editable from '../../editable';
import InspectorControls from '../../inspector-controls';
import BlockDescription from '../../block-description';

const toEditableValue = value => value.map( ( subValue => subValue.children ) );
const fromEditableValue = value => value.map( ( subValue ) => ( {
	children: subValue,
} ) );

registerBlockType( 'core/quote', {
	title: __( 'Quote' ),
	icon: 'format-quote',
	category: 'common',

	attributes: {
		value: {
			type: 'array',
			source: 'query',
			selector: 'blockquote > p',
			query: {
				children: {
					source: 'node',
				},
			},
			default: [],
		},
		citation: {
			type: 'array',
			source: 'children',
			selector: 'footer',
		},
		align: {
			type: 'string',
		},
		style: {
			type: 'number',
			default: 1,
		},
	},

	transforms: {
		from: [
			{
				type: 'block',
				blocks: [ 'core/paragraph' ],
				transform: ( { content } ) => {
					return createBlock( 'core/quote', {
						value: [
							{ children: <p key="1">{ content }</p> },
						],
					} );
				},
			},
			{
				type: 'block',
				blocks: [ 'core/heading' ],
				transform: ( { content } ) => {
					return createBlock( 'core/quote', {
						value: [
							{ children: <p key="1">{ content }</p> },
						],
					} );
				},
			},
			{
				type: 'pattern',
				regExp: /^>\s/,
				transform: ( { content } ) => {
					return createBlock( 'core/quote', {
						value: [
							{ children: <p key="1">{ content }</p> },
						],
					} );
				},
			},
			{
				type: 'raw',
				isMatch: ( node ) => node.nodeName === 'BLOCKQUOTE',
			},
		],
		to: [
			{
				type: 'block',
				blocks: [ 'core/paragraph' ],
				transform: ( { value, citation, ...attrs } ) => {
					const textElement = value[ 0 ];
					if ( ! textElement ) {
						return createBlock( 'core/paragraph', {
							content: citation,
						} );
					}
					const textContent = isString( textElement.children ) ?
						textElement.children :
						textElement.children.props.children;
					if ( Array.isArray( value ) || citation ) {
						const text = createBlock( 'core/paragraph', {
							content: textContent,
						} );
						const quote = createBlock( 'core/quote', {
							...attrs,
							citation,
							value: Array.isArray( value ) ?
								value.slice( 1 ) :
								[],
						} );

						return [ text, quote ];
					}
					return createBlock( 'core/paragraph', {
						content: textContent,
					} );
				},
			},
			{
				type: 'block',
				blocks: [ 'core/heading' ],
				transform: ( { value, citation, ...attrs } ) => {
					const textElement = value[ 0 ];
					if ( ! textElement ) {
						return createBlock( 'core/heading', {
							content: citation,
						} );
					}
					const textContent = isString( textElement.children ) ?
						textElement.children :
						textElement.children.props.children;
					if ( Array.isArray( value ) || citation ) {
						const text = createBlock( 'core/heading', {
							content: textContent,
						} );
						const quote = createBlock( 'core/quote', {
							...attrs,
							citation,
							value: Array.isArray( value ) ?
								value.slice( 1 ) :
								[],
						} );

						return [ text, quote ];
					}
					return createBlock( 'core/heading', {
						content: textContent,
					} );
				},
			},
		],
	},

	edit( { attributes, setAttributes, focus, setFocus, mergeBlocks, className } ) {
		const { align, value, citation, style } = attributes;
		const focusedEditable = focus ? focus.editable || 'value' : null;

		return [
			focus && (
				<BlockControls key="controls">
					<Toolbar controls={ [ 1, 2 ].map( ( variation ) => ( {
						icon: 1 === variation ? 'format-quote' : 'testimonial',
						title: sprintf( __( 'Quote style %d' ), variation ),
						isActive: Number( style ) === variation,
						onClick() {
							setAttributes( { style: variation } );
						},
					} ) ) } />
					<AlignmentToolbar
						value={ align }
						onChange={ ( nextAlign ) => {
							setAttributes( { align: nextAlign } );
						} }
					/>
				</BlockControls>
			),
			focus && (
				<InspectorControls key="inspector">
					<BlockDescription>
						<p>{ __( 'Quote. In quoting others, we cite ourselves. (Julio Cortázar)' ) }</p>
					</BlockDescription>
				</InspectorControls>
			),
			<blockquote
				key="quote"
				className={ `${ className } blocks-quote-style-${ style }` }
			>
				<Editable
					multiline="p"
					value={ toEditableValue( value ) }
					onChange={
						( nextValue ) => setAttributes( {
							value: fromEditableValue( nextValue ),
						} )
					}
					focus={ focusedEditable === 'value' ? focus : null }
					onFocus={ ( props ) => setFocus( { ...props, editable: 'value' } ) }
					onMerge={ mergeBlocks }
					style={ { textAlign: align } }
					placeholder={ __( 'Write quote…' ) }
				/>
				{ ( ( citation && citation.length > 0 ) || !! focus ) && (
					<Editable
						tagName="footer"
						value={ citation }
						placeholder={ __( 'Write citation…' ) }
						onChange={
							( nextCitation ) => setAttributes( {
								citation: nextCitation,
							} )
						}
						focus={ focusedEditable === 'citation' ? focus : null }
						onFocus={ ( props ) => setFocus( { ...props, editable: 'citation' } ) }
					/>
				) }
			</blockquote>,
		];
	},

	save( { attributes } ) {
		const { align, value, citation, style } = attributes;

		return (
			<blockquote
				className={ `blocks-quote-style-${ style }` }
				style={ { textAlign: align ? align : null } }
			>
				{ value.map( ( paragraph, i ) => (
					<p key={ i }>{ paragraph.children && paragraph.children.props.children }</p>
				) ) }
				{ citation && citation.length > 0 && (
					<footer>{ citation }</footer>
				) }
			</blockquote>
		);
	},
} );
