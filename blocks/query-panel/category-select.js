/**
 * WordPress dependencies
 */
import { withAPIData } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { buildTermsTree } from '../../editor/utils/terms';
import TermTreeSelect from '../term-tree-select';

function CategorySelect( { label, noOptionLabel, categories, selectedCategory, onChange } ) {
	if ( ! categories || ! categories.data ) {
		return null;
	}
	return (
		<TermTreeSelect
			{ ...{ label, noOptionLabel, onChange } }
			termsTree={ buildTermsTree( categories.data ) }
			selectedTerm={ selectedCategory }
		/>
	);
}

const applyWithAPIData = withAPIData( () => ( {
	categories: '/wp/v2/categories',
} ) );

export default applyWithAPIData( CategorySelect );
