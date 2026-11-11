"""Behavior checks for safe, incremental media management; no real archive writes."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

spec=importlib.util.spec_from_file_location('sce_media',Path(__file__).with_name('media.py'))
media=importlib.util.module_from_spec(spec);spec.loader.exec_module(media)

class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.res=self.root/'resources';self.res.mkdir();self.source=self.res/'original.jpg';Image.new('RGB',(120,80),'blue').save(self.source)
        self.allowed=self.root/'apps/web/src/assets/photos';self.allowed.mkdir(parents=True)
        self.patches=[patch.object(media,'ROOT',self.root),patch.object(media,'RES',self.res),patch.object(media,'CACHE',self.res/'cache.json'),patch.object(media,'CATALOG',self.root/'catalog.json'),patch.object(media,'ALLOWED',[self.allowed])]
        for p in self.patches:p.start();self.addCleanup(p.stop)
        self.catalog={'version':1,'profiles':{'photo':{'width':60,'quality':85}},'placements':{'home.intro':'portrait'},'assets':{'portrait':{'kind':'image','label':'Portrait','source':'original.jpg','profile':'photo','alt':'A blue test image','outputs':['apps/web/src/assets/photos/portrait.jpg']}}}
    def test_paths_cannot_escape_sources_or_output_folders(self):
        with self.assertRaises(ValueError):media.inside(self.res,'../outside.jpg')
        with self.assertRaises(ValueError):media.output_path('apps/web/src/pages/unsafe.jpg')
    def test_unknown_placement_and_duplicate_output_are_rejected(self):
        self.catalog['placements']['home.intro']='missing'
        with self.assertRaises(ValueError):media.validate(self.catalog)
        self.catalog['placements']['home.intro']='portrait';self.catalog['assets']['other']=dict(self.catalog['assets']['portrait'])
        with self.assertRaises(ValueError):media.validate(self.catalog)
    def test_build_is_incremental_and_keeps_original_bytes(self):
        before=self.source.read_bytes()
        with patch.object(media,'prepare',wraps=media.prepare) as prepare:
            media.build(self.catalog,[]);media.build(self.catalog,[]);self.assertEqual(prepare.call_count,1)
        self.assertEqual(before,self.source.read_bytes())
        with Image.open(self.allowed/'portrait.jpg') as image:self.assertEqual(image.size,(60,40))
        self.catalog['profiles']['photo']['width']=30
        media.build(self.catalog,[])
        with Image.open(self.allowed/'portrait.jpg') as image:self.assertEqual(image.size,(30,20))
    def test_failed_preparation_keeps_the_previous_output(self):
        media.prepare('portrait',self.catalog['assets']['portrait'],self.catalog);target=self.allowed/'portrait.jpg';before=target.read_bytes();self.source.write_bytes(b'not an image')
        with self.assertRaises(OSError):media.prepare('portrait',self.catalog['assets']['portrait'],self.catalog)
        self.assertEqual(target.read_bytes(),before);self.assertEqual(list(self.allowed.glob('*.working-*')),[])
    def test_replacement_copies_a_version_without_changing_original_or_output_name(self):
        original=self.source.read_bytes();replacement=self.root/'new.jpg';Image.new('RGB',(30,30),'red').save(replacement)
        media.replace(self.catalog,'portrait',str(replacement),alt='New red portrait')
        a=self.catalog['assets']['portrait'];self.assertTrue(a['source'].startswith('incoming/portrait/'));self.assertEqual(self.source.read_bytes(),original);self.assertEqual(a['outputs'],['apps/web/src/assets/photos/portrait.jpg']);self.assertEqual(a['alt'],'New red portrait')
    def test_legacy_images_can_be_replaced_without_guessing_a_source(self):
        a=self.catalog['assets']['portrait'];a['source']=None;a['profile']='legacy'
        media.validate(self.catalog);media.replace(self.catalog,'portrait',str(self.source));self.assertEqual(a['profile'],'photo')
    def test_wrong_media_kind_cannot_be_assigned_to_an_image_placement(self):
        a=self.catalog['assets']['portrait'];a['kind']='video';a['profile']='film'
        with self.assertRaisesRegex(ValueError,'requires an image asset'):media.validate(self.catalog)

if __name__=='__main__':unittest.main()
